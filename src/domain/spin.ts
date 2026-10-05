import type { SpinInstruction } from "./models";
/** Keeps the pointer visibly inside the slice: 8% of it, at least 2°, never past 45%. */
export function landingMargin(count: number): number {
  return Math.min(0.45, Math.max(0.08, (2 * count) / 360));
}
/**
 * `position` is where the pointer stops inside the slice: 0 is its leading edge, 1 its
 * trailing edge. Purely visual; the winner is already decided.
 */
export function landingRotation(
  current: number,
  index: number,
  count: number,
  rotations = 6,
  position = 0.5,
): number {
  const target = (360 - ((index + position) * 360) / count) % 360;
  return current + 360 * rotations + ((target - (current % 360) + 360) % 360);
}
/**
 * Deterministic resting position per wheel, so multiple wheels never look cloned.
 * Purely visual: it only seeds the first spin's start, never the winner or probability.
 */
export function idleRotation(wheelIndex: number, count: number): number {
  if (count < 1) return 0;
  // Golden-ratio spacing spreads the centred slice evenly for any wheel count.
  const slice = Math.floor(wheelIndex * count * 0.618) % count;
  return (360 - ((slice + 0.5) * 360) / count) % 360;
}
/** Absolute-time playback works before start, during a spin, and after its deadline. */
export function getSpinTiming(spin: SpinInstruction, now: number) {
  const start = Date.parse(spin.startAt);
  return {
    delayMs: Math.max(0, start - now),
    elapsedMs: Math.min(spin.durationMs, Math.max(0, now - start)),
    finished: now >= start + spin.durationMs,
  };
}
/** The rim pegs the pointer ticks against; BeerWheel draws them at these angles. */
export const RIM_PEGS = 32;
/** Pegs that passed the top between two unwrapped rotations. Purely visual. */
export function pegsPassed(from: number, to: number, pegs = RIM_PEGS): number {
  const step = 360 / pegs;
  return Math.abs(Math.floor(to / step) - Math.floor(from / step));
}
/** Continues `previous` with the shortest turn to `raw` (any angle, e.g. from a matrix). */
export function unwrapRotation(previous: number, raw: number): number {
  const delta = ((((raw - previous) % 360) + 540) % 360) - 180;
  return previous + delta;
}
