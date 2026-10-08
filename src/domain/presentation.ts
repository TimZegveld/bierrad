import type { ScheduledDraw } from "../../shared/protocol";
import type { BeerWheelSession } from "./models";
/** Spectators see the countdown take over the screen this long before a planned start. */
export const COUNTDOWN_LEAD_MS = 10000;
export type SpectatorPhase =
  | "empty"
  | "waiting"
  | "countdown"
  | "spinning"
  | "result";
export interface SpectatorPresentation {
  readonly phase: SpectatorPhase;
  /** Authoritative start in server time, when one is known. */
  readonly startAt?: number;
  /** Server time at which the phase changes without a new snapshot. */
  readonly nextChangeAt?: number;
  readonly skipped: boolean;
}
/**
 * Presentation only, recomputed from the latest server snapshot and corrected clock.
 * It never stores its own draw state, so it cannot drift from the session.
 */
export function spectatorPresentation(
  session: BeerWheelSession,
  scheduled: ScheduledDraw | undefined,
  serverNow: number,
): SpectatorPresentation {
  const draw = session.activeDraw;
  if (draw) {
    if (session.state === "finished") return { phase: "result", skipped: false };
    const startAt = Date.parse(draw.startAt);
    return serverNow < startAt
      ? { phase: "countdown", startAt, nextChangeAt: startAt, skipped: false }
      : { phase: "spinning", startAt, skipped: false };
  }
  const skipped = scheduled?.status === "skipped";
  if (!session.participants.length) return { phase: "empty", skipped };
  if (scheduled && !skipped) {
    const startAt = Date.parse(scheduled.startAt);
    const from = startAt - COUNTDOWN_LEAD_MS;
    // "refreshing" means the server is about to issue the draw.
    if (scheduled.status === "refreshing" || serverNow >= from)
      return { phase: "countdown", startAt, skipped };
    return { phase: "waiting", startAt, nextChangeAt: from, skipped };
  }
  return { phase: "waiting", skipped };
}
/** A channel page keeps the finale on the wheels this long; ballots open about then. */
export const RESULT_AFTER_MS = 60000;
/** Server time at which the last wheel of a draw stops. */
export function drawEnd(session: BeerWheelSession): number | undefined {
  const draw = session.activeDraw;
  if (!draw) return;
  return (
    Date.parse(draw.startAt) +
    Math.max(...draw.spins.map((spin) => spin.durationMs))
  );
}
/**
 * When a round's channel page swaps the wheels for its result: a minute after
 * the finale, or at once when a planned draw was skipped. Undefined while the
 * round is still on (not drawn, or still spinning).
 */
export function resultShownAt(
  session: BeerWheelSession,
  scheduled: ScheduledDraw | undefined,
): number | undefined {
  if (session.state === "finished") {
    const end = drawEnd(session);
    return end === undefined ? undefined : end + RESULT_AFTER_MS;
  }
  if (!session.activeDraw && scheduled?.status === "skipped") return -Infinity;
}
/** 3, 2, 1, then 0 for "go"; undefined while the countdown is still announcing. */
export function countdownDigit(remainingMs: number): number | undefined {
  if (remainingMs <= 0) return 0;
  const seconds = Math.ceil(remainingMs / 1000);
  return seconds <= 3 ? seconds : undefined;
}
/** Spectators see "nog m:ss" before a planned start, only within the last hour. */
export const TIME_LEFT_SHOWN_MS = 3600000;
/** "2:14" for the time until a planned start; undefined when too far or already due. */
export function timeLeftLabel(remainingMs: number): string | undefined {
  if (remainingMs <= 0 || remainingMs > TIME_LEFT_SHOWN_MS) return undefined;
  const seconds = Math.ceil(remainingMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function countLabel(
  count: number,
  singular: string,
  plural: string,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
/** "Jan", "Jan & Rob", "Jan, Rob & Lisa". */
export function joinNames(names: readonly string[]): string {
  if (names.length < 2) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}
/** Default grid before the stage has been measured. */
export function wheelColumns(count: number): number {
  if (count <= 3) return count;
  if (count === 4) return 2;
  return count <= 6 ? 3 : 4;
}
/**
 * Column count that gives the largest wheels on the measured stage, so a 16:9 TV
 * shows four wheels in a row while a taller screen stacks them 2×2.
 */
export function bestWheelColumns(
  count: number,
  width: number,
  height: number,
  gap: number,
): number {
  if (count < 1 || width <= 0 || height <= 0) return wheelColumns(count);
  let best = 1,
    bestSize = -Infinity;
  for (let columns = 1; columns <= count; columns++) {
    const rows = Math.ceil(count / columns);
    // Labels and winner cards take roughly 15% of a row plus a fixed margin.
    const size = Math.min(
      (width - (columns - 1) * gap) / columns,
      ((height - ((rows - 1) * gap) / 2) / rows) * 0.85 - 60,
    );
    if (size > bestSize + 0.5) {
      best = columns;
      bestSize = size;
    }
  }
  return best;
}
