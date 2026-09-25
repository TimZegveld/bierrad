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
/** Secret-panel settings: relative odds per participant and forced winners for one draw. */
export interface DrawRig {
  readonly weights?: Readonly<Record<string, number>>;
  readonly forcedIds?: readonly string[];
}
function randomFraction(): number {
  return randomIndex(0x100000000) / 0x100000000;
}
/** Forced winners first (random subset if too many), then weighted picks without replacement; wheel order is shuffled. */
export function selectRiggedWinners(
  participants: readonly Participant[],
  count: number,
  rig: DrawRig = {},
): Participant[] {
  const forcedIds = new Set(rig.forcedIds ?? []);
  const forced = participants.filter((p) => forcedIds.has(p.id));
  const weight = (p: Participant) => {
    const value = rig.weights?.[p.id] ?? 1;
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  const rest = participants.filter((p) => !forcedIds.has(p.id));
  if (!forced.length && rest.every((p) => weight(p) === 1))
    return selectUniqueWinners(participants, count);
  // Validates count and IDs with the regular rules.
  selectUniqueWinners(participants, count);
  const winners = forced.length
    ? selectUniqueWinners(forced, Math.min(count, forced.length))
    : [];
  const pool = [...rest];
  while (winners.length < count) {
    const total = pool.reduce((sum, p) => sum + weight(p), 0);
    let index = randomIndex(pool.length);
    if (total > 0) {
      let target = randomFraction() * total;
      index = pool.findIndex((p) => (target -= weight(p)) < 0);
      // Floating-point leftovers fall to the last participant with odds.
      if (index < 0)
        index = pool.length - 1 - [...pool].reverse().findIndex((p) => weight(p) > 0);
    }
    winners.push(...pool.splice(index, 1));
  }
  return selectUniqueWinners(winners, winners.length);
}
