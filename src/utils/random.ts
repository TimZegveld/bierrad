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
  participants: readonly Participant[],
  excludedIds: string[] = [],
): Participant {
  const eligible = participants.filter((p) => !excludedIds.includes(p.id));
  return eligible[randomIndex(eligible.length)];
}
