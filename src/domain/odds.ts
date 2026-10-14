import type { BeerWheelSession } from "./models";
import { goalOdds } from "../utils/goalDraw";

/** Weighted draws with more winners stay exact up to this many orderings. */
const MAX_ORDERINGS = 200000;

export interface WinOdds {
  /** Per participant: the chance to win anything in this round. */
  total: ReadonlyMap<string, number>;
  /** Feestrad only: per goal, each pool member's chance to win that goal. */
  perGoal?: readonly ReadonlyMap<string, number>[];
}
/**
 * The fair odds of the round as the server draws it: a Feestrad's joint draw,
 * or unique winners with odds proportional to slice size. Display only; it
 * never touches the draw.
 */
export function winOdds(session: BeerWheelSession): WinOdds | undefined {
  const people = session.participants;
  if (!people.length) return;
  try {
    if (session.goals) {
      const perGoal = goalOdds(session.goals);
      const total = new Map(people.map((p) => [p.id, 0]));
      for (const goal of perGoal)
        for (const [id, chance] of goal)
          total.set(id, (total.get(id) ?? 0) + chance);
      return { total, perGoal };
    }
    const weights = people.map((p) => p.weight ?? 1);
    const count = Math.min(Math.max(session.winnerCount, 1), people.length);
    const sum = weights.reduce((a, b) => a + b, 0);
    if (count === 1 || weights.every((w) => w === weights[0]))
      return {
        total: new Map(
          people.map((p, i) =>
            count === 1 ? [p.id, weights[i] / sum] : [p.id, count / people.length],
          ),
        ),
      };
    return weightedUnique(people.map((p) => p.id), weights, count);
  } catch {
    return;
  }
}
/** Unique winners picked one by one with odds proportional to weight. */
function weightedUnique(
  ids: readonly string[],
  weights: readonly number[],
  count: number,
): WinOdds | undefined {
  if (ids.length ** count > MAX_ORDERINGS) return;
  const total = new Map(ids.map((id) => [id, 0]));
  const walk = (left: number, chance: number, taken: ReadonlySet<number>) => {
    if (!left) return;
    const rest = weights.reduce((sum, w, i) => (taken.has(i) ? sum : sum + w), 0);
    weights.forEach((w, i) => {
      if (taken.has(i)) return;
      const p = (chance * w) / rest;
      total.set(ids[i], total.get(ids[i])! + p);
      walk(left - 1, p, new Set([...taken, i]));
    });
  };
  walk(count, 1, new Set());
  return { total };
}
const percent = new Intl.NumberFormat("nl-NL", {
  style: "percent",
  maximumFractionDigits: 0,
});
/** Whole percentages; a real but tiny chance never shows as 0 %. */
export function formatChance(chance: number): string {
  if (chance > 0 && chance < 0.005) return `<${percent.format(0.01)}`;
  if (chance < 1 && chance > 0.995) return `>${percent.format(0.99)}`;
  return percent.format(chance);
}
