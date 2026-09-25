import type { Participant } from "../domain/models";
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
/** Partial Fisher–Yates: every ordered sample has equal probability; never mutates the pool. */
export function selectUniqueWinners(
  participants: readonly Participant[],
  count: number,
): Participant[] {
  if (!Number.isInteger(count) || count < 1 || count > participants.length)
    throw new Error(
      "Het aantal bierhalers moet tussen 1 en het aantal deelnemers liggen.",
    );
  if (new Set(participants.map((p) => p.id)).size !== participants.length)
    throw new Error("Deelnemers moeten unieke IDs hebben.");
  const shuffled = [...participants];
  for (let i = 0; i < count; i++) {
    const j = i + randomIndex(shuffled.length - i);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}
