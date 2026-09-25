import type {
  BeerWheelSession,
  ClientRole,
  Participant,
  SessionCapabilities,
} from "../domain/models";
import {
  createSession,
  eligibleParticipants,
  finishSpin,
  resetSession,
  startSpin,
} from "../domain/drawEngine";
import { getCapabilities } from "../domain/capabilities";
import { pickWinner } from "../utils/random";
import type { ParticipantSource } from "../services/ParticipantSource";
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
  clock?: SessionClock;
}
/** Local authority. The application owns its lifetime, independently of React subscriptions. */
export class LocalSessionController implements SessionController {
  private snapshot: SessionSnapshot;
  private listeners = new Set<() => void>();
  private loading = false;
  private disposed = false;
  private initialization?: Promise<void>;
  private cancelSpin?: () => void;
  private readonly clock: SessionClock;
  private readonly role: ClientRole;
  constructor(private readonly options: Options = {}) {
    this.clock = options.clock ?? clock;
    this.role = options.role ?? "host";
    const session = createSession(crypto.randomUUID());
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
    // Copies are owned by the engine; freezing prevents callers from bypassing commands.
    session.participants.forEach(Object.freeze);
    Object.freeze(session.participants);
    Object.freeze(session.winnerIds);
    if (session.spin) {
      Object.freeze(session.spin.participantIds);
      Object.freeze(session.spin);
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
      const participants = (await this.options.source?.getParticipants()) ?? [];
      if (!this.disposed) {
        this.loading = false;
        this.publish(createSession(before.id, participants));
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
    const session = createSession(this.snapshot.session.id, participants);
    let notice = "";
    try {
      if (session.participants.length)
        this.options.saveParticipants?.(session.participants);
    } catch {
      notice =
        "Opslaan is niet beschikbaar. Deze ronde werkt wel; de lijst blijft alleen in dit venster.";
    }
    this.publish(session, notice);
  }
  async startFirstSpin(): Promise<void> {
    this.begin(1);
  }
  async startSecondSpin(): Promise<void> {
    this.begin(2);
  }
  private begin(round: 1 | 2) {
    this.require("canStartSpin");
    const current = this.snapshot.session;
    if (current.state !== (round === 1 ? "ready" : "first-winner"))
      throw new Error("Deze ronde kan nog niet starten.");
    const winner = pickWinner(eligibleParticipants(current));
    const session = startSpin(current, winner.id, {
      id: crypto.randomUUID(),
      startAt: new Date(this.clock.now()).toISOString(),
      durationMs: 4800,
    });
    this.publish(session);
    if (this.disposed) return;
    const spin = session.spin!;
    const complete = () => {
      if (this.disposed) return;
      const remaining =
        Date.parse(spin.startAt) + spin.durationMs - this.clock.now();
      if (remaining > 0) {
        this.cancelSpin = this.clock.schedule(complete, remaining);
        return;
      }
      this.cancelSpin = undefined;
      this.publish(
        finishSpin(this.snapshot.session, spin.id, this.clock.now()),
      );
    };
    this.cancelSpin = this.clock.schedule(complete, spin.durationMs);
  }
  async reset(): Promise<void> {
    this.require("canReset");
    this.publish(resetSession(this.snapshot.session));
  }
  async newDraw(): Promise<void> {
    this.require("canReset");
    this.publish(createSession(this.snapshot.session.id));
  }
  dispose(): void {
    this.disposed = true;
    this.cancelSpin?.();
    this.listeners.clear();
  }
}
