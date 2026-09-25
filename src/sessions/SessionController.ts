import type {
  BeerWheelSession,
  Participant,
  SessionCapabilities,
} from "../domain/models";
export interface SessionSnapshot {
  readonly session: BeerWheelSession;
  readonly capabilities: SessionCapabilities;
  readonly notice: string;
}
/** Stable immutable snapshots for useSyncExternalStore. Remote implementations publish server snapshots. */
export interface SessionController {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  setParticipants(participants: readonly Participant[]): Promise<void>;
  restoreParticipants(): Promise<void>;
  startFirstSpin(): Promise<void>;
  startSecondSpin(): Promise<void>;
  reset(): Promise<void>;
  newDraw(): Promise<void>;
}
