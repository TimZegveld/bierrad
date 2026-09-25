import type {
  BeerWheelSession,
  ClientRole,
  Participant,
  SessionCapabilities,
} from "../domain/models";
import {
  createSession,
  advanceDraw,
  resetSession,
  startDraw,
} from "../domain/drawEngine";
import { getCapabilities } from "../domain/capabilities";
import type { DrawRig } from "../utils/random";
import type { ParticipantSource } from "../services/ParticipantSource";
import type { WinnerCountPreference } from "../services/WinnerCountPreference";
import type { SessionController, SessionSnapshot } from "./SessionController";

export interface SessionClock {
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}
const clock: SessionClock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};
interface Options {
  role?: ClientRole;
  source?: ParticipantSource;
  saveParticipants?: (participants: readonly Participant[]) => void;
  preference?: WinnerCountPreference;
  clock?: SessionClock;
}
/** Local authority. Lifetime and deadlines are independent of React subscriptions. */
export class LocalSessionController implements SessionController {
  private snapshot: SessionSnapshot;
  private listeners = new Set<() => void>();
  private loading = false;
  private disposed = false;
  private initialization?: Promise<void>;
  private cancelTick?: () => void;
  private readonly clock: SessionClock;
  private readonly role: ClientRole;
  private preferredWinnerCount = 2;
  constructor(private readonly options: Options = {}) {
    this.clock = options.clock ?? clock;
    this.role = options.role ?? "host";
    try {
      const preferred = options.preference?.load();
      if (
        preferred !== undefined &&
        Number.isSafeInteger(preferred) &&
        preferred >= 1
      )
        this.preferredWinnerCount = preferred;
    } catch {
      /* Storage is optional; the default remains usable. */
    }
    const session = createSession(
      crypto.randomUUID(),
      [],
      this.preferredWinnerCount,
    );
    this.snapshot = {
      session,
      capabilities: getCapabilities(this.role, session),
      notice: "",
    };
    this.publish(session);
  }
  getSnapshot = (): SessionSnapshot => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(session: BeerWheelSession, notice = "") {
    session.participants.forEach(Object.freeze);
    Object.freeze(session.participants);
    Object.freeze(session.winnerIds);
    if (session.activeDraw) {
      session.activeDraw.spins.forEach(Object.freeze);
      Object.freeze(session.activeDraw.spins);
      Object.freeze(session.activeDraw.participantIds);
      Object.freeze(session.activeDraw);
    }
    Object.freeze(session);
    this.snapshot = Object.freeze({
      session,
      capabilities: Object.freeze(
        getCapabilities(this.role, session, this.loading),
      ),
      notice,
    });
    for (const listener of this.listeners) listener();
  }
  private require(capability: keyof SessionCapabilities) {
    if (this.disposed || !this.snapshot.capabilities[capability])
      throw new Error("Deze actie is nu niet toegestaan.");
  }
  initialize(): Promise<void> {
    return (this.initialization ??=
      this.options.source && this.role === "host"
        ? this.restoreParticipants()
        : Promise.resolve());
  }
  async restoreParticipants(): Promise<void> {
    this.require("canManageParticipants");
    const before = this.snapshot.session;
    this.loading = true;
    this.publish(before);
    try {
      const people = (await this.options.source?.getParticipants()) ?? [];
      if (!this.disposed) {
        this.loading = false;
        this.publish(
          createSession(before.id, people, this.preferredWinnerCount),
        );
      }
    } catch {
      if (!this.disposed) {
        this.loading = false;
        this.publish(
          before,
          "De opgeslagen lijst is niet beschikbaar. Je kunt gewoon handmatig deelnemers toevoegen.",
        );
      }
    }
  }
  async setParticipants(participants: readonly Participant[]): Promise<void> {
    this.require("canManageParticipants");
    const session = createSession(
      this.snapshot.session.id,
      participants,
      this.preferredWinnerCount,
    );
    let notice = "";
    try {
      if (session.participants.length)
        this.options.saveParticipants?.(session.participants);
    } catch {
      notice =
        "Opslaan is niet beschikbaar. Deze trekking werkt wel; de lijst blijft alleen in dit venster.";
    }
    this.publish(session, notice);
  }
  async setWinnerCount(count: number): Promise<void> {
    this.require("canConfigureDraw");
    if (
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > this.snapshot.session.participants.length
    )
      throw new Error("Kies een aantal tussen 1 en het aantal deelnemers.");
    this.preferredWinnerCount = count;
    let notice = "";
    try {
      this.options.preference?.save(count);
    } catch {
      notice =
        "Je aantalkeuze kan niet worden opgeslagen, maar werkt wel in dit venster.";
    }
    this.publish(
      createSession(
        this.snapshot.session.id,
        this.snapshot.session.participants,
        count,
      ),
      notice,
    );
  }
  async startDraw(rig?: DrawRig): Promise<void> {
    this.require("canStartDraw");
    // A short shared lead-in lets all mounted wheels pick up the same timestamp.
    const session = startDraw(this.snapshot.session, {
      id: crypto.randomUUID(),
      startAt: new Date(this.clock.now() + 100).toISOString(),
    }, rig);
    this.cancelTick?.();
    this.publish(session);
    this.scheduleNextReveal(session.activeDraw!.id);
  }
  private scheduleNextReveal(drawId: string) {
    if (this.disposed) return;
    const session = this.snapshot.session;
    const draw = session.activeDraw;
    if (session.state !== "spinning" || !draw || draw.id !== drawId) return;
    const deadlines = draw.spins
      .filter((spin) => !session.winnerIds.includes(spin.winnerId))
      .map((spin) => Date.parse(draw.startAt) + spin.durationMs);
    const delay = Math.max(0, Math.min(...deadlines) - this.clock.now());
    this.cancelTick = this.clock.schedule(() => {
      if (this.disposed) return;
      this.cancelTick = undefined;
      const next = advanceDraw(this.snapshot.session, drawId, this.clock.now());
      if (next !== this.snapshot.session) this.publish(next);
      this.scheduleNextReveal(drawId);
    }, delay);
  }
  async reset(): Promise<void> {
    this.require("canReset");
    this.cancelTick?.();
    this.cancelTick = undefined;
    this.publish(resetSession(this.snapshot.session));
  }
  dispose(): void {
    this.disposed = true;
    this.cancelTick?.();
    this.listeners.clear();
  }
}
