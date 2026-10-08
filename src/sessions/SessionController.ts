import type {
  BeerWheelSession,
  Participant,
  SessionCapabilities,
} from "../domain/models";
export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "unavailable";
export interface LiveInfo {
  role: import("../domain/models").ClientRole;
  status: ConnectionStatus;
  expiresAt?: string;
  scheduledDraw?: import("../../shared/protocol").ScheduledDraw;
  /** Counts only, while the round can be reviewed. */
  review?: import("../../shared/reviews").ReviewProgress;
  /** Per winner, once the round's review has closed. */
  reviewOutcomes?: import("../../shared/reviews").ReviewOutcome[];
}
export interface SessionSnapshot {
  readonly session: BeerWheelSession;
  readonly capabilities: SessionCapabilities;
  readonly notice: string;
  readonly clockOffsetMs?: number;
  readonly live?: LiveInfo;
}
/** Stable immutable snapshots. Remote implementations publish server snapshots. */
export interface SessionController {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  setParticipants(participants: readonly Participant[]): Promise<void>;
  restoreParticipants(): Promise<void>;
  setWinnerCount(count: number): Promise<void>;
  /** Remote sessions ignore the rig: the server alone picks winners. */
  startDraw(rig?: import("../utils/random").DrawRig): Promise<void>;
  reset(): Promise<void>;
  setScheduledDraw?(startAt: string | null): Promise<void>;
}
