import type { WheelVariant } from "../../shared/variant";
export interface Participant {
  readonly id: string;
  readonly name: string;
  /** Server-set relative slice size and odds (Koekrad nominations); absent means 1. */
  readonly weight?: number;
}
export type DrawState =
  | "setup"
  | "ready"
  | "countdown"
  | "spinning"
  | "finished";
export type ClientRole = "host" | "spectator";
/** Serializable playback, degrees clockwise from the top and UTC start time. */
export interface SpinInstruction {
  readonly id: string;
  readonly wheelIndex: number;
  readonly winnerId: string;
  readonly startAt: string;
  readonly durationMs: number;
  readonly rotations: number;
  readonly startRotation: number;
  readonly targetRotation: number;
  readonly easing: "cubic-bezier(.3,0,0,1)";
}
export interface DrawInstruction {
  readonly id: string;
  readonly startAt: string;
  /** One full, ordered pool shared by every wheel. */
  readonly participantIds: readonly string[];
  /** Frozen slice sizes parallel to `participantIds`; absent when all are equal. */
  readonly weights?: readonly number[];
  readonly spins: readonly SpinInstruction[];
}
export interface BeerWheelSession {
  readonly variant?: WheelVariant;
  /** Koekrad rounds only: the round's word, display only. */
  readonly title?: string;
  readonly id: string;
  readonly participants: readonly Participant[];
  readonly winnerCount: number;
  readonly state: DrawState;
  readonly mode: "manual" | "scheduled";
  /** Only revealed results, in wheel order. All predetermined results live in activeDraw. */
  readonly winnerIds: readonly string[];
  /** Retained after completion for identical replay/remount and repeat draw positions. */
  readonly activeDraw?: DrawInstruction;
  readonly scheduledAt?: string;
}
export interface SessionCapabilities {
  readonly canViewSession: boolean;
  readonly canControlSession: boolean;
  readonly canManageParticipants: boolean;
  readonly canConfigureDraw: boolean;
  readonly canStartDraw: boolean;
  readonly canReset: boolean;
}
