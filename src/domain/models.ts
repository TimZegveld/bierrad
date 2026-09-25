export interface Participant {
  readonly id: string;
  readonly name: string;
}
export type DrawState =
  | "setup"
  | "ready"
  | "countdown"
  | "spinning-first"
  | "first-winner"
  | "spinning-second"
  | "finished";
export type ClientRole = "host" | "spectator";

/** Serializable instructions: degrees clockwise from the top, UTC start time. */
export interface SpinInstruction {
  readonly id: string;
  readonly round: 1 | 2;
  readonly participantIds: readonly string[];
  readonly winnerId: string;
  readonly startAt: string;
  readonly durationMs: number;
  readonly startRotation: number;
  readonly targetRotation: number;
  readonly easing: "cubic-bezier(.35,0,.12,1)";
}
export interface BeerWheelSession {
  readonly id: string;
  /** Original ordered roster; winners are never removed from this snapshot. */
  readonly participants: readonly Participant[];
  readonly state: DrawState;
  readonly mode: "manual" | "scheduled";
  readonly winnerIds: readonly string[];
  /** Latest instruction retained after completion so remounts keep the wheel position. */
  readonly spin?: SpinInstruction;
  /** Reserved for future scheduling; no scheduler exists in the local controller. */
  readonly scheduledAt?: string;
}
export interface SessionCapabilities {
  readonly canViewSession: boolean;
  readonly canControlSession: boolean;
  readonly canManageParticipants: boolean;
  readonly canStartSpin: boolean;
  readonly canReset: boolean;
}
