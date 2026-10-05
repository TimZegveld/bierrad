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
  ratings?: import("../../shared/ratings").RatingStatus;
  role: import("../domain/models").ClientRole;
  status: ConnectionStatus;
  expiresAt?: string;
  slack?: import("../../shared/protocol").SlackHostStatus;
  scheduledDraw?: import("../../shared/protocol").ScheduledDraw;
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
  setRatings?(
    settings: import("../../shared/ratings").RatingSettings,
  ): Promise<void>;
  beginRating?(drawId: string): void;
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
  setParticipants(participants: readonly Participant[]): Promise<void>;
  restoreParticipants(): Promise<void>;
  setWinnerCount(count: number): Promise<void>;
  /** Remote sessions ignore the rig: the server alone picks winners. */
  startDraw(rig?: import("../utils/random").DrawRig): Promise<void>;
  reset(): Promise<void>;
  /** `shareSpectatorLink` posts the spectator link to the Slack thread before the start. */
  setScheduledDraw?(
    startAt: string | null,
    shareSpectatorLink?: boolean,
  ): Promise<void>;
  /** Host routes carrying the spectator link can share it via Slack. */
  readonly canShareSpectatorLink?: boolean;
  importSlack?(permalink?: string): Promise<void>;
  useManualSource?(): Promise<void>;
  retrySlackResult?(): Promise<void>;
}
