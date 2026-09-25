import type { Participant } from "../types";
export function randomIndex(length: number): number {
  if (!Number.isInteger(length) || length < 1 || length > 0x100000000)
    throw new Error("Ongeldig aantal deelnemers");
  const limit = Math.floor(0x100000000 / length) * length;
  const buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % length;
}
export function pickWinner(
  participants: Participant[],
  excludedIds: string[] = [],
): Participant {
  const eligible = participants.filter((p) => !excludedIds.includes(p.id));
  return eligible[randomIndex(eligible.length)];
}
export function landingRotation(
  current: number,
  index: number,
  count: number,
): number {
  const target = (360 - ((index + 0.5) * 360) / count) % 360;
  return current + 360 * 6 + ((target - (current % 360) + 360) % 360);
}
