import type { SpinInstruction } from "./models";
export function landingRotation(
  current: number,
  index: number,
  count: number,
  rotations = 6,
): number {
  const target = (360 - ((index + 0.5) * 360) / count) % 360;
  return current + 360 * rotations + ((target - (current % 360) + 360) % 360);
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
