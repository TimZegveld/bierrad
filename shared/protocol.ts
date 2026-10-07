import type { ReviewProgress } from "./reviews";
import type { WheelVariant } from "./variant";
import type {
  DrawInstruction,
  DrawState,
  Participant,
  ClientRole,
} from "../src/domain/models";
export interface ScheduledDraw {
  startAt: string;
  status: "pending" | "refreshing" | "skipped";
}
/** Explicit DTO; never serialize backend storage directly. */
export interface PublicBeerWheelSession {
  variant?: WheelVariant;
  /** Koekrad rounds only: the validated word from `/koekrad <titel>`. */
  title?: string;
  participants: readonly Participant[];
  winnerCount: number;
  state: DrawState;
  winnerIds: readonly string[];
  activeDraw?: DrawInstruction;
  expiresAt: string;
  revision: number;
  scheduledDraw?: ScheduledDraw;
  /** Counts only, while a channel round can be reviewed. */
  review?: ReviewProgress;
}
export type HostCommand =
  | { type: "setParticipants"; names: string[] }
  | { type: "setWinnerCount"; count: number }
  | { type: "startDraw" }
  | { type: "setScheduledDraw"; startAt: string | null }
  | { type: "reset" }
  | { type: "endSession" };
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
