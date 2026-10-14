import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { goalOdds, selectGoalWinners, type GoalPool } from "../utils/goalDraw";
import { createSession } from "../domain/drawEngine";
import { formatChance, winOdds } from "../domain/odds";
import type { BeerWheelSession, Participant } from "../domain/models";

const person = (id: string, weight?: number): Participant =>
  weight ? { id, name: `Naam ${id}`, weight } : { id, name: `Naam ${id}` };
function session(people: Participant[], winnerCount = 1, goals?: BeerWheelSession["goals"]): BeerWheelSession {
  return { ...createSession("s"), participants: people, winnerCount, ...(goals ? { goals } : {}) };
}
const close = (actual: number | undefined, expected: number, delta = 1e-9) =>
  assert.ok(Math.abs(actual! - expected) < delta, `${actual} ≉ ${expected}`);
function seeded(t: TestContext, seed = 0x2f6b1d3) {
  let state = seed;
  t.mock.method(crypto, "getRandomValues", (array: Uint32Array) => {
    for (let i = 0; i < array.length; i++) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      array[i] = state >>> 0;
    }
    return array;
  });
}

test("one wheel: equal slices share the winners evenly, bigger slices have proportionally more odds", () => {
  const four = winOdds(session(["a", "b", "c", "d"].map((id) => person(id)), 2))!;
  for (const id of ["a", "b", "c", "d"]) close(four.total.get(id), 0.5);
  assert.equal(four.perGoal, undefined);
  const koek = winOdds(session([person("a", 3), person("b"), person("c")]))!;
  close(koek.total.get("a"), 0.6);
  close(koek.total.get("b"), 0.2);
  // Weighted with more winners: picked one by one, the odds add up to the winners.
  const two = winOdds(session([person("a", 3), person("b"), person("c")], 2))!;
  close([...two.total.values()].reduce((a, b) => a + b, 0), 2);
  // b first (1/5), or after a (3/5 · 1/2), or after c (1/5 · 1/4).
  close(two.total.get("b"), 0.2 + 0.3 + 0.05);
  assert.equal(winOdds(session([])), undefined);
});

test("Feestrad: per goal and in total, nobody wins twice and the one left for a goal gets it", () => {
  const goals = [
    { variant: "coffee" as const, participantIds: ["a", "b"] },
    { variant: "water" as const, participantIds: ["a"] },
    { variant: "cookie" as const, participantIds: ["b", "c"] },
  ];
  const odds = winOdds(session(["a", "b", "c"].map((id) => person(id)), 3, goals))!;
  assert.deepEqual(odds.perGoal!.map((g) => Object.fromEntries(g)), [
    { a: 0, b: 1 },
    { a: 1 },
    { b: 0, c: 1 },
  ]);
  assert.deepEqual(Object.fromEntries(odds.total), { a: 1, b: 1, c: 1 });
  // Two people in both goals: each wins one of them for sure.
  const both = goalOdds([{ participantIds: ["a", "b"] }, { participantIds: ["a", "b"] }]);
  close(both[0].get("a"), 0.5);
  close(both[1].get("a"), 0.5);
});

test("the Feestrad odds match the real draw", (t) => {
  seeded(t);
  const goals: GoalPool[] = [
    { participantIds: ["a", "b", "c"] },
    { participantIds: ["a", "d"] },
    { participantIds: ["b", "c", "e"], weights: [1, 3, 2] },
  ];
  const odds = goalOdds(goals);
  const runs = 20000;
  const seen = goals.map(() => new Map<string, number>());
  for (let i = 0; i < runs; i++)
    selectGoalWinners(goals).forEach((id, goal) => {
      if (id) seen[goal].set(id, (seen[goal].get(id) ?? 0) + 1);
    });
  goals.forEach((_, goal) => {
    close([...odds[goal].values()].reduce((a, b) => a + b, 0), 1);
    for (const [id, chance] of odds[goal])
      close((seen[goal].get(id) ?? 0) / runs, chance, 0.015);
  });
});

test("percentages are whole, and a tiny chance never reads as zero", () => {
  assert.match(formatChance(0.5), /^50\s?%$/);
  assert.match(formatChance(0.001), /^<1\s?%$/);
  assert.match(formatChance(0.999), /^>99\s?%$/);
  assert.match(formatChance(0), /^0\s?%$/);
});
