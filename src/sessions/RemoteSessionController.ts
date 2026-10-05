import type { WheelVariant } from "../../shared/variant";
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
  spectatorCapability?: string;
  fetch?: typeof fetch;
  socket?: (url: string, protocols: string[]) => WebSocket;
}
function endpoint(api: string, path: string): string {
  return `${api.replace(/\/$/, "")}${path}`;
}
export async function createLiveSession(
  apiUrl: string,
  variant: WheelVariant = "beer",
): Promise<CreatedSession> {
  const response = await fetch(endpoint(apiUrl, "/api/sessions"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ variant }),
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? "Even rustig aan. Probeer over een minuut opnieuw."
        : "Het live rad is even niet bereikbaar.",
    );
  return response.json() as Promise<CreatedSession>;
}
export interface LiveSeed {
  names: readonly string[];
  winnerCount: number;
}
// In-memory only: the hash navigation keeps this module alive, so the wheel the
// host just set up can follow them into live mode without URLs or web storage.
const seeds = new Map<string, LiveSeed>();
/** Hands the local roster to the next host controller for this capability. */
export function seedLiveSession(hostCapability: string, seed: LiveSeed) {
  seeds.clear();
  if (seed.names.length) seeds.set(hostCapability, seed);
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
  private slack?: PublicBeerWheelSession["slack"];
  private scheduledDraw?: PublicBeerWheelSession["scheduledDraw"];
  private ratings?: PublicBeerWheelSession["ratings"];
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
      live: {
        role: this.options.role,
        status,
        expiresAt: this.expiresAt,
        slack: this.slack,
        scheduledDraw: this.scheduledDraw,
        ratings: this.ratings,
      },
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
    this.slack = this.options.role === "host" ? dto.slack : undefined;
    this.expiresAt = dto.expiresAt;
    this.scheduledDraw = dto.scheduledDraw;
    this.ratings = dto.ratings;
    const oldDraw = this.snapshot.session.activeDraw;
    const session: BeerWheelSession = Object.freeze({
      id: "live",
      mode: "manual",
      variant: dto.variant ?? "beer",
      participants: dto.participants,
      winnerCount: dto.winnerCount,
      state: dto.state,
      winnerIds: dto.winnerIds,
      activeDraw: dto.activeDraw?.id === oldDraw?.id ? oldDraw : dto.activeDraw,
    });
    this.armExpiry();
    if (this.terminal) return;
    this.publish(
      this.ws?.readyState === 1 ? "connected" : "connecting",
      session,
    );
    if (this.snapshot.live?.status === "connected") void this.applySeed();
  }
  /** Sends a handed-over local roster through the regular host commands, once. */
  private async applySeed() {
    const seed = seeds.get(this.options.capability);
    if (!seed || this.options.role !== "host") return;
    seeds.delete(this.options.capability);
    const { session } = this.snapshot;
    if (session.state !== "setup" || session.participants.length) return;
    try {
      await this.command({ type: "setParticipants", names: [...seed.names] });
      const count = Math.min(
        seed.winnerCount,
        this.snapshot.session.participants.length,
      );
      if (count >= 1 && count !== this.snapshot.session.winnerCount)
        await this.command({ type: "setWinnerCount", count });
    } catch {
      this.publish(
        this.snapshot.live?.status ?? "connecting",
        this.snapshot.session,
        "Je deelnemers konden niet worden overgenomen. Voeg ze hier opnieuw toe.",
      );
    }
  }
  private armExpiry() {
    clearTimeout(this.expiry);
    if (this.disposed || this.terminal || !this.expiresAt) return;
    const remaining = Date.parse(this.expiresAt) - (Date.now() + this.offset);
    if (remaining <= 0) {
      this.unavailable();
      return;
    }
    // Browser timers overflow above ~24.8 days; recheck long plans in bounded chunks.
    this.expiry = setTimeout(
      () => this.armExpiry(),
      Math.min(remaining, 2147483647),
    );
  }
  private unavailable() {
    this.terminal = true;
    this.slack = undefined;
    this.scheduledDraw = undefined;
    this.ratings = undefined;
    clearTimeout(this.retry);
    clearTimeout(this.expiry);
    clearInterval(this.heartbeat);
    this.ws?.close();
    this.options.capability = "";
    this.publish(
      "unavailable",
      { ...empty(), variant: this.snapshot.session.variant },
      "Dit rad is afgelopen of niet beschikbaar.",
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
      signal: AbortSignal.timeout(
        command?.type === "slackImport" ? 35000 : 10000,
      ),
    });
    if (this.disposed || this.terminal) return;
    if (response.status === 404) {
      this.unavailable();
      return;
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      const slackMessages: Record<string, string> = {
        ratings_slack_required:
          "Laad Slack-deelnemers om sterren te gebruiken, of zet beoordelingen uit voor deze trekking.",
        ending:
          "Deze sessie loopt te snel af voor deze trekking en de gekozen beoordelingswachttijd. Start een nieuwe sessie.",
        invalid_schedule:
          "Kies een toekomstig tijdstip binnen de komende 30 dagen.",
        schedule_access_expires:
          "De Slack-toegang van deze sessie is niet lang genoeg geldig voor deze planning plus één uur. Start een nieuw rad via Inloggen met Slack.",
        slack_link:
          "Plak een volledige Slack-berichtlink. Een threadlink verwijst naar het hoofdbericht.",
        slack_incomplete:
          "Slack gaf niet alle reagerende personen terug. Er is niets geïmporteerd.",
        slack_too_many: "Er passen maximaal 100 deelnemers in een live rad.",
        slack_rate_limited:
          "Slack vraagt even geduld. Wacht minstens een minuut en probeer later opnieuw.",
        slack_rejected:
          "Controleer of de Slack-bot toegang tot het gesprek heeft en de juiste rechten heeft.",
        slack_response:
          "Slack gaf geen volledige geldige deelnemerslijst terug. Je lijst is niet aangepast.",
        slack_unavailable:
          "Slack ophalen is niet gelukt. Je lijst is niet aangepast.",
        slack_posting:
          "De uitslag wordt nog naar Slack verstuurd. Een ogenblik…",
        slack_busy: "De deelnemers worden nog opgehaald. Een ogenblik…",
      };
      if (data.code && slackMessages[data.code])
        throw new Error(slackMessages[data.code]);
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
  importSlack(permalink?: string) {
    return this.command({
      type: "slackImport",
      ...(permalink === undefined ? {} : { permalink }),
    });
  }
  useManualSource() {
    return this.command({ type: "slackManual" });
  }
  retrySlackResult() {
    return this.command({ type: "slackRetry" });
  }
  setWinnerCount(count: number) {
    return this.command({ type: "setWinnerCount", count });
  }
  setRatings(settings: import("../../shared/ratings").RatingSettings) {
    return this.command({ type: "setRatings", settings });
  }
  beginRating(drawId: string) {
    if (
      this.terminal ||
      this.disposed ||
      this.snapshot.live?.status !== "connected"
    )
      throw new Error("Verbind eerst opnieuw om te beoordelen.");
    // Top-level POST allows a host-only OAuth cookie without third-party cookies or URL credentials.
    const form = document.createElement("form");
    form.method = "POST";
    form.action = endpoint(this.options.apiUrl, "/auth/slack/rating");
    for (const [name, value] of Object.entries({
      capability: this.options.capability,
      drawId,
    })) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.append(input);
    }
    document.body.append(form);
    form.submit();
    form.remove();
  }
  get canShareSpectatorLink() {
    return this.options.role === "host" && !!this.options.spectatorCapability;
  }
  setScheduledDraw(startAt: string | null, shareSpectatorLink = false) {
    return this.command({
      type: "setScheduledDraw",
      startAt,
      ...(startAt !== null &&
      shareSpectatorLink &&
      this.options.spectatorCapability
        ? { spectatorCapability: this.options.spectatorCapability }
        : {}),
    });
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
