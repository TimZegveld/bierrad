export interface Participant {
  readonly id: string;
  readonly name: string;
}
export type DrawState =
  "setup" | "ready" | "countdown" | "spinning" | "finished";
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
  readonly easing: "cubic-bezier(.35,0,.12,1)";
}
export interface DrawInstruction {
  readonly id: string;
  readonly startAt: string;
  /** One full, ordered pool shared by every wheel. */
  readonly participantIds: readonly string[];
  readonly spins: readonly SpinInstruction[];
}
export interface BeerWheelSession {
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
