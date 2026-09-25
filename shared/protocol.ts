import type {
  DrawInstruction,
  DrawState,
  Participant,
  ClientRole,
} from "../src/domain/models";
/** Explicit DTO; never serialize backend storage directly. */
export interface PublicBeerWheelSession {
  participants: readonly Participant[];
  winnerCount: number;
  state: DrawState;
  winnerIds: readonly string[];
  activeDraw?: DrawInstruction;
  expiresAt: string;
  revision: number;
}
export type HostCommand =
  | { type: "setParticipants"; names: string[] }
  | { type: "setWinnerCount"; count: number }
  | { type: "startDraw" }
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
