import type { SpinInstruction } from "./models";
/** Keeps the pointer visibly inside the slice: 8% of it, at least 2°, never past 45%. */
export function landingMargin(count: number, size = 1 / count): number {
  return Math.min(0.45, Math.max(0.08, 2 / (360 * size)));
}
/** Slices as fractions of the circle, clockwise from the top; equal without weights. */
export function wheelSlices(
  count: number,
  weights?: readonly number[],
): { start: number; size: number }[] {
  const sizes = Array.from({ length: count }, (_, i) => weights?.[i] ?? 1);
  const total = sizes.reduce((sum, w) => sum + w, 0);
  let before = 0;
  return sizes.map((w) => {
    const slice = { start: before / total, size: w / total };
    before += w;
    return slice;
  });
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
  weights?: readonly number[],
): number {
  const slice = wheelSlices(count, weights)[index];
  const target = (360 - (slice.start + position * slice.size) * 360) % 360;
  return current + 360 * rotations + ((target - (current % 360) + 360) % 360);
}
/**
 * Deterministic resting position per wheel, so multiple wheels never look cloned.
 * Purely visual: it only seeds the first spin's start, never the winner or probability.
 */
export function idleRotation(
  wheelIndex: number,
  count: number,
  weights?: readonly number[],
): number {
  if (count < 1) return 0;
  // Golden-ratio spacing spreads the centred slice evenly for any wheel count.
  const slice = wheelSlices(count, weights)[
    Math.floor(wheelIndex * count * 0.618) % count
  ];
  return (360 - (slice.start + slice.size / 2) * 360) % 360;
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
