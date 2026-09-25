import type {
  DrawInstruction,
  DrawState,
  Participant,
  ClientRole,
} from "../src/domain/models";
export interface SlackHostStatus {
  enabled: boolean;
  source: "manual" | "slack";
  importing: boolean;
  count?: number;
  syncedAt?: string;
  result?: {
    drawId: string;
    status: "pending" | "posting" | "posted" | "failed" | "uncertain";
    retryAt?: number;
  };
}
/** Explicit DTO; never serialize backend storage directly. */
export interface PublicBeerWheelSession {
  participants: readonly Participant[];
  winnerCount: number;
  state: DrawState;
  winnerIds: readonly string[];
  activeDraw?: DrawInstruction;
  expiresAt: string;
  revision: number;
  slack?: SlackHostStatus;
}
export type HostCommand =
  | { type: "setParticipants"; names: string[] }
  | { type: "setWinnerCount"; count: number }
  | { type: "startDraw" }
  | { type: "reset" }
  | { type: "endSession" }
  | { type: "slackImport"; permalink?: string }
  | { type: "slackManual" }
  | { type: "slackRetry" };
export type ClientToServerMessage = { type: "ping" };
export type ServerToClientMessage =
  | {
      type: "snapshot";
      session: PublicBeerWheelSession;
      role: ClientRole;
      serverNow: number;
    }
  | { type: "pong"; serverNow: number }
  | { type: "unavailable" }
  | { type: "error"; code: "forbidden" | "invalid" | "rate_limited" };
export interface CreatedSession {
  hostCapability: string;
  spectatorCapability: string;
  expiresAt: string;
}
