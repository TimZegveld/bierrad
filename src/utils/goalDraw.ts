import { randomFraction, randomIndex } from "./random";

/** One goal's pool: participant IDs with optional whole weights (absent means 1). */
export interface GoalPool {
  readonly participantIds: readonly string[];
  readonly weights?: readonly number[];
}
/** A Feestrad round has at most coffee, water and koek; it also bounds the work below. */
export const MAX_GOALS = 3;

type Weights = ReadonlyMap<string, number>;

function weightsOf(pool: GoalPool): Weights {
  const map = new Map<string, number>();
  pool.participantIds.forEach((id, i) => {
    const weight = pool.weights?.[i] ?? 1;
    if (!id || map.has(id) || !Number.isSafeInteger(weight) || weight < 1 || weight > 100)
      throw new Error("Ongeldige of dubbele deelnemers.");
    map.set(id, weight);
  });
  return map;
}
function sum(pool: Weights, excluded: ReadonlySet<string>): number {
  let total = 0;
  for (const [id, w] of pool) if (!excluded.has(id)) total += w;
  return total;
}
/**
 * The summed weight of every way to give each pool its own winner, nobody
 * twice and nobody from `excluded`; the weight of a way is the product of its
 * winners' weights. Two pools in closed form, so three goals stay quadratic.
 */
function ways(pools: readonly Weights[], excluded: ReadonlySet<string>): number {
  if (!pools.length) return 1;
  if (pools.length === 1) return sum(pools[0], excluded);
  if (pools.length === 2) {
    const [a, b] = pools;
    let overlap = 0;
    for (const [id, w] of a)
      if (!excluded.has(id) && b.has(id)) overlap += w * b.get(id)!;
    return sum(a, excluded) * sum(b, excluded) - overlap;
  }
  const [first, ...rest] = pools;
  let total = 0;
  for (const [id, w] of first)
    if (!excluded.has(id)) total += w * ways(rest, new Set([...excluded, id]));
  return total;
}
/** Index into `weights` with odds proportional to each weight; exact while the total fits 32 bits. */
function pick(weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let target =
    total <= 0x100000000 ? randomIndex(total) : randomFraction() * total;
  const index = weights.findIndex((w) => (target -= w) < 0);
  // Floating-point leftovers fall to the last option with odds.
  return index >= 0 ? index : weights.length - 1 - [...weights].reverse().findIndex((w) => w > 0);
}
/**
 * One joint draw for a Feestrad: each goal gets one winner from its own pool
 * and nobody wins twice. Every valid outcome has odds proportional to the
 * product of its winners' weights, so the order of the goals does not matter
 * and joining several goals gives no advantage. When not every goal can be
 * filled, as many as possible are; a goal left out gets `undefined`.
 */
export function selectGoalWinners(
  goals: readonly GoalPool[],
): (string | undefined)[] {
  if (!goals.length || goals.length > MAX_GOALS)
    throw new Error("Een feestronde heeft één tot drie doelen.");
  const pools = goals.map(weightsOf);
  const none = new Set<string>();
  // Every subset of goals that can be filled, largest first.
  const subsets = Array.from({ length: 2 ** pools.length }, (_, mask) =>
    pools.map((_, i) => i).filter((i) => mask & (1 << i)),
  )
    .map((indices) => ({ indices, ways: ways(indices.map((i) => pools[i]), none) }))
    .filter((s) => s.ways > 0);
  const size = Math.max(...subsets.map((s) => s.indices.length));
  const largest = subsets.filter((s) => s.indices.length === size);
  const winners: (string | undefined)[] = goals.map(() => undefined);
  const { indices } = largest[pick(largest.map((s) => s.ways))];
  const taken = new Set<string>();
  indices.forEach((goal, n) => {
    const rest = indices.slice(n + 1).map((i) => pools[i]);
    const candidates = [...pools[goal]].filter(([id]) => !taken.has(id));
    const odds = candidates.map(
      ([id, w]) => w * ways(rest, new Set([...taken, id])),
    );
    const [id] = candidates[pick(odds)];
    winners[goal] = id;
    taken.add(id);
  });
  return winners;
}
