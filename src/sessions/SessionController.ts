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
  slack?: import("../../shared/protocol").SlackHostStatus;
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
  startDraw(): Promise<void>;
  reset(): Promise<void>;
  importSlack?(permalink?: string): Promise<void>;
  useManualSource?(): Promise<void>;
  retrySlackResult?(): Promise<void>;
}
