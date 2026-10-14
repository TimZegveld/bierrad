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
  /** Feestrad goals only: this wheel's own frozen pool; absent means the draw's shared pool. */
  readonly participantIds?: readonly string[];
  /** Frozen slice sizes parallel to the spin's own `participantIds`. */
  readonly weights?: readonly number[];
}
export interface DrawInstruction {
  readonly id: string;
  readonly startAt: string;
  /**
   * One full, ordered pool shared by every wheel. In a Feestrad draw everyone
   * who joined any goal; each spin then carries its goal's own pool.
   */
  readonly participantIds: readonly string[];
  /** Frozen slice sizes parallel to `participantIds`; absent when all are equal. */
  readonly weights?: readonly number[];
  /** One per wheel that turns; a Feestrad goal nobody is left for has none. */
  readonly spins: readonly SpinInstruction[];
}
/**
 * One goal of a Feestrad round: its own wheel and its own pool from the
 * session's participants. The variant and title are display only.
 */
export interface DrawGoal {
  readonly variant: WheelVariant;
  readonly title?: string;
  readonly participantIds: readonly string[];
  /** Slice sizes parallel to `participantIds`; absent when all are equal. */
  readonly weights?: readonly number[];
}
export interface BeerWheelSession {
  readonly variant?: WheelVariant;
  /** Koekrad rounds only: the round's word, display only. */
  readonly title?: string;
  readonly id: string;
  readonly participants: readonly Participant[];
  /**
   * Feestrad rounds only: one wheel and one winner per goal, nobody twice.
   * `participants` then holds everyone who joined any goal.
   */
  readonly goals?: readonly DrawGoal[];
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
