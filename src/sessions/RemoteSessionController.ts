import type {
  Participant,
  ClientRole,
  BeerWheelSession,
} from "../domain/models";
import { getCapabilities } from "../domain/capabilities";
import type {
  SessionController,
  SessionSnapshot,
  ConnectionStatus,
} from "./SessionController";
import type {
  CreatedSession,
  HostCommand,
  ServerToClientMessage,
  PublicBeerWheelSession,
} from "../../shared/protocol";

const empty = (): BeerWheelSession => ({
  id: "live",
  participants: [],
  winnerCount: 2,
  state: "setup",
  mode: "manual",
  winnerIds: [],
});
export interface RemoteOptions {
  apiUrl: string;
  capability: string;
  role: ClientRole;
  fetch?: typeof fetch;
  socket?: (url: string, protocols: string[]) => WebSocket;
}
function endpoint(api: string, path: string): string {
  return `${api.replace(/\/$/, "")}${path}`;
}
export async function createLiveSession(
  apiUrl: string,
): Promise<CreatedSession> {
  const response = await fetch(endpoint(apiUrl, "/api/sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Even rustig aan. Probeer over een minuut opnieuw."
        : "Live Bierrad is even niet bereikbaar.",
    );
  return response.json() as Promise<CreatedSession>;
}
/** Owns transport; no participant storage, winner selection or official local transitions. */
export class RemoteSessionController implements SessionController {
  private snapshot: SessionSnapshot;
  private listeners = new Set<() => void>();
  private ws?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private expiry?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private terminal = false;
  private attempt = 0;
  private revision = -1;
  private offset = 0;
  private bestRtt = Infinity;
  private pingAt?: number;
  private lastReceived = 0;
  private expiresAt?: string;
  private connecting = false;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: RemoteOptions) {
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.snapshot = this.makeSnapshot(empty(), "connecting");
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private makeSnapshot(
    session: BeerWheelSession,
    status: ConnectionStatus,
    notice = "",
  ): SessionSnapshot {
    const capabilities = getCapabilities(
      this.options.role,
      session,
      status !== "connected",
    );
    return Object.freeze({
      session,
      capabilities: {
        ...capabilities,
        canViewSession: status !== "unavailable",
      },
      notice,
      clockOffsetMs: this.offset,
      live: { role: this.options.role, status, expiresAt: this.expiresAt },
    });
  }
  private publish(
    status: ConnectionStatus,
    session = this.snapshot.session,
    notice = "",
  ) {
    if (this.disposed) return;
    this.snapshot = this.makeSnapshot(session, status, notice);
    for (const listener of this.listeners) listener();
  }
  private calibrate(serverNow: number, sent: number) {
    const received = Date.now(),
      rtt = received - sent;
    if (rtt >= 0 && rtt < this.bestRtt) {
      this.bestRtt = rtt;
      this.offset = serverNow - (sent + received) / 2;
    }
  }
  private receive(dto: PublicBeerWheelSession) {
    if (this.terminal || this.disposed || dto.revision < this.revision) return;
    this.revision = dto.revision;
    this.expiresAt = dto.expiresAt;
    const oldDraw = this.snapshot.session.activeDraw;
    const session: BeerWheelSession = Object.freeze({
      id: "live",
      mode: "manual",
      participants: dto.participants,
      winnerCount: dto.winnerCount,
      state: dto.state,
      winnerIds: dto.winnerIds,
      activeDraw: dto.activeDraw?.id === oldDraw?.id ? oldDraw : dto.activeDraw,
    });
    clearTimeout(this.expiry);
    const remaining = Date.parse(dto.expiresAt) - (Date.now() + this.offset);
    if (remaining <= 0) {
      this.unavailable();
      return;
    }
    this.expiry = setTimeout(() => this.unavailable(), remaining);
    this.publish(
      this.ws?.readyState === 1 ? "connected" : "connecting",
      session,
    );
  }
  private unavailable() {
    this.terminal = true;
    clearTimeout(this.retry);
    clearTimeout(this.expiry);
    clearInterval(this.heartbeat);
    this.ws?.close();
    this.options.capability = "";
    this.publish(
      "unavailable",
      empty(),
      "🍻 Dit Bierrad is afgelopen of niet beschikbaar.",
    );
  }
  private async request(path: string, command?: HostCommand) {
    const sent = Date.now();
    const response = await this.fetcher(endpoint(this.options.apiUrl, path), {
      method: command ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.options.capability}`,
        ...(command ? { "Content-Type": "application/json" } : {}),
      },
      ...(command
        ? { body: JSON.stringify({ ...command, revision: this.revision }) }
        : {}),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(10000),
    });
    if (this.disposed || this.terminal) return;
    if (response.status === 404) {
      this.unavailable();
      return;
    }
    if (!response.ok) {
      if (response.status === 409) {
        await this.request("/api/session");
        throw new Error(
          "De sessie is veranderd. Bekijk de actuele stand en probeer opnieuw.",
        );
      }
      throw new Error(
        response.status === 429
          ? "Even rustig aan. Probeer zo opnieuw."
          : response.status === 400
            ? "Controleer de namen en het aantal. Namen moeten uniek zijn en maximaal 32 tekens bevatten."
            : "Deze actie is niet gelukt. Probeer opnieuw.",
      );
    }
    const message = (await response.json()) as ServerToClientMessage;
    if (message.type === "unavailable") {
      this.unavailable();
      return;
    }
    if (message.type !== "snapshot" || message.role !== this.options.role) {
      this.unavailable();
      return;
    }
    this.calibrate(message.serverNow, sent);
    this.receive(message.session);
  }
  async initialize(): Promise<void> {
    if (
      this.connecting ||
      this.disposed ||
      this.terminal ||
      this.ws?.readyState === 1
    )
      return;
    this.connecting = true;
    this.bestRtt = Infinity;
    try {
      await this.request("/api/session");
      if (this.terminal || this.disposed) return;
      const url = endpoint(this.options.apiUrl, "/api/socket").replace(
        /^http/,
        "ws",
      );
      const ws = (this.options.socket ?? ((u, p) => new WebSocket(u, p)))(url, [
        "bierrad",
        `auth.${this.options.capability}`,
      ]);
      this.ws = ws;
      const handshake = setTimeout(() => {
        if (ws.readyState !== 1) {
          ws.close();
          this.reconnect();
        }
      }, 10000);
      ws.onopen = () => {
        clearTimeout(handshake);
        this.lastReceived = Date.now();
      };
      ws.onmessage = (event) => {
        if (this.disposed || this.terminal || ws !== this.ws) return;
        try {
          const message = JSON.parse(
            String(event.data),
          ) as ServerToClientMessage;
          this.lastReceived = Date.now();
          if (message.type === "unavailable") {
            this.unavailable();
            return;
          }
          if (message.type === "snapshot") {
            if (message.role !== this.options.role) {
              this.unavailable();
              return;
            }
            this.attempt = 0;
            this.receive(message.session);
          } else if (message.type === "pong" && this.pingAt !== undefined) {
            this.calibrate(message.serverNow, this.pingAt);
            this.pingAt = undefined;
            this.publish("connected");
          }
        } catch {
          ws.close();
        }
      };
      ws.onerror = () => ws.close();
      ws.onclose = () => {
        clearTimeout(handshake);
        if (ws === this.ws) this.reconnect();
      };
      clearInterval(this.heartbeat);
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastReceived > 35000) {
          ws.close();
          this.reconnect();
          return;
        }
        if (ws.readyState === 1) {
          this.pingAt = Date.now();
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 15000);
    } catch {
      this.reconnect();
    } finally {
      this.connecting = false;
    }
  }
  private reconnect() {
    if (this.disposed || this.terminal || this.retry) return;
    clearInterval(this.heartbeat);
    this.publish(
      "reconnecting",
      this.snapshot.session,
      "Verbinding herstellen… De bediening wacht op de actuele stand.",
    );
    this.retry = setTimeout(
      () => {
        this.retry = undefined;
        void this.initialize();
      },
      Math.min(30000, 1000 * 2 ** this.attempt++),
    );
  }
  private async command(command: HostCommand) {
    if (
      this.disposed ||
      this.terminal ||
      this.options.role !== "host" ||
      this.snapshot.live?.status !== "connected"
    )
      throw new Error("Deze actie is nu niet beschikbaar.");
    await this.request("/api/command", command);
  }
  setParticipants(people: readonly Participant[]) {
    return this.command({
      type: "setParticipants",
      names: people.map((p) => p.name),
    });
  }
  setWinnerCount(count: number) {
    return this.command({ type: "setWinnerCount", count });
  }
  startDraw() {
    return this.command({ type: "startDraw" });
  }
  reset() {
    return this.command({ type: "reset" });
  }
  endSession() {
    return this.command({ type: "endSession" });
  }
  async restoreParticipants() {
    throw new Error(
      "Live deelnemers worden alleen tijdelijk in deze sessie bewaard.",
    );
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.retry);
    clearTimeout(this.expiry);
    clearInterval(this.heartbeat);
    this.ws?.close();
    this.options.capability = "";
    this.listeners.clear();
  }
}
