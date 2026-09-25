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
/** Stable immutable snapshots. Remote implementations publish server snapshots. */
export interface SessionController {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  setParticipants(participants: readonly Participant[]): Promise<void>;
  restoreParticipants(): Promise<void>;
  setWinnerCount(count: number): Promise<void>;
  startDraw(): Promise<void>;
  reset(): Promise<void>;
}
