import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { selectGoalWinners, type GoalPool } from "../utils/goalDraw";
import {
  advanceDraw,
  createSession,
  resetSession,
  startDraw,
  wheelCount,
  wheelParticipants,
  withGoals,
} from "../domain/drawEngine";
import { getCapabilities } from "../domain/capabilities";
import type { DrawGoal, Participant } from "../domain/models";

const person = (id: string): Participant => ({ id, name: `Naam ${id}` });
const ids = (...list: string[]): GoalPool => ({ participantIds: list });
/** Deterministic randomness, so the frequency checks below never flake. */
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
function frequencies(goals: GoalPool[], runs = 20000) {
  const counts = new Map<string, number>();
  for (let i = 0; i < runs; i++) {
    const key = selectGoalWinners(goals).map((w) => w ?? "-").join(",");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Map([...counts].map(([k, n]) => [k, n / runs]));
}

test("nobody ever wins two goals", (t) => {
  seeded(t);
  const pools = [ids("a", "b", "c"), ids("a", "b"), ids("b", "c", "d")];
  for (let i = 0; i < 2000; i++) {
    const winners = selectGoalWinners(pools);
    assert.ok(winners.every((w) => w));
    assert.equal(new Set(winners).size, 3);
    winners.forEach((w, goal) =>
      assert.ok(pools[goal].participantIds.includes(w!)),
    );
  }
});

test("every valid outcome is equally likely, whatever the order of the goals", (t) => {
  seeded(t);
  // Valid: (a,b) (b,a) (c,a) (c,b). Drawing coffee first would give c only a third.
  const coffeeFirst = frequencies([ids("a", "b", "c"), ids("a", "b")]);
  assert.deepEqual([...coffeeFirst.keys()].sort(), ["a,b", "b,a", "c,a", "c,b"]);
  for (const odds of coffeeFirst.values()) assert.ok(Math.abs(odds - 0.25) < 0.015);
  const waterFirst = frequencies([ids("a", "b"), ids("a", "b", "c")]);
  for (const odds of waterFirst.values()) assert.ok(Math.abs(odds - 0.25) < 0.015);
});

test("someone who is the only option for a goal is kept for it", () => {
  for (let i = 0; i < 50; i++)
    assert.deepEqual(selectGoalWinners([ids("a", "b"), ids("a")]), ["b", "a"]);
});

test("when not every goal can be filled, as many as possible are, fairly", (t) => {
  seeded(t);
  const odds = frequencies([ids("a"), ids("a"), ids("a", "b")]);
  assert.deepEqual([...odds.keys()].sort(), ["-,a,b", "a,-,b"]);
  for (const share of odds.values()) assert.ok(Math.abs(share - 0.5) < 0.015);
});

test("an empty goal stays empty and an empty round picks nobody", () => {
  assert.deepEqual(selectGoalWinners([ids(), ids("a")]), [undefined, "a"]);
  assert.deepEqual(selectGoalWinners([ids(), ids()]), [undefined, undefined]);
});

test("weights give proportional odds within their own goal", (t) => {
  seeded(t);
  const odds = frequencies([{ participantIds: ["a", "b"], weights: [3, 1] }, ids("c")]);
  assert.ok(Math.abs(odds.get("a,c")! - 0.75) < 0.015);
  assert.ok(Math.abs(odds.get("b,c")! - 0.25) < 0.015);
});

test("one to three goals with valid, unique IDs only", () => {
  assert.throws(() => selectGoalWinners([]));
  assert.throws(() => selectGoalWinners([ids("a"), ids("b"), ids("c"), ids("d")]));
  assert.throws(() => selectGoalWinners([ids("a", "a")]));
  assert.throws(() => selectGoalWinners([{ participantIds: ["a"], weights: [0] }]));
});

test("large pools stay quick", () => {
  const big = Array.from({ length: 300 }, (_, i) => `p${i}`);
  const started = Date.now();
  for (let i = 0; i < 5; i++)
    selectGoalWinners([ids(...big), ids(...big), ids(...big)]);
  assert.ok(Date.now() - started < 2000);
});

const people = ["a", "b", "c"].map(person);
const goals: DrawGoal[] = [
  { variant: "coffee", participantIds: ["a", "b"] },
  { variant: "water", participantIds: ["a"] },
  { variant: "cookie", title: "taart", participantIds: ["c"], weights: [2] },
];
const timing = { id: "draw", startAt: "2026-10-13T12:00:00.000Z" };

test("a Feestrad has one wheel per goal, each showing its own pool", () => {
  const session = withGoals(createSession("s", people, 1), goals);
  assert.equal(session.winnerCount, 3);
  assert.equal(wheelCount(session), 3);
  assert.deepEqual(wheelParticipants(session, 0).map((p) => p.id), ["a", "b"]);
  assert.deepEqual(wheelParticipants(session, 1).map((p) => p.id), ["a"]);
  assert.deepEqual(wheelParticipants(session, 2), [{ ...people[2], weight: 2 }]);
});

test("the joint draw freezes each wheel's pool and lands every wheel on a different winner", () => {
  const ready = withGoals(createSession("s", people, 1), goals);
  const drawn = startDraw(ready, timing);
  const draw = drawn.activeDraw!;
  assert.deepEqual(draw.participantIds, ["a", "b", "c"]);
  assert.deepEqual(draw.spins.map((s) => [s.wheelIndex, s.winnerId]), [
    [0, "b"],
    [1, "a"],
    [2, "c"],
  ]);
  assert.deepEqual(draw.spins[0].participantIds, ["a", "b"]);
  assert.deepEqual(draw.spins[2].weights, [2]);
  // The replay reads the frozen pool, not the goal.
  const replay = { ...drawn, goals: undefined };
  assert.deepEqual(wheelParticipants(replay, 1).map((p) => p.id), ["a"]);
  const end = Date.parse(timing.startAt) + Math.max(...draw.spins.map((s) => s.durationMs));
  const finished = advanceDraw(drawn, "draw", end);
  assert.equal(finished.state, "finished");
  assert.deepEqual([...finished.winnerIds].sort(), ["a", "b", "c"]);
});

test("a goal nobody is left for gets no spin, and the draw still finishes", () => {
  const session = withGoals(createSession("s", [person("a")], 1), [
    { variant: "coffee", participantIds: ["a"] },
    { variant: "water", participantIds: ["a"] },
  ]);
  assert.ok(getCapabilities("host", session).canStartDraw);
  const drawn = startDraw(session, timing);
  assert.equal(drawn.activeDraw!.spins.length, 1);
  assert.equal(wheelCount(drawn), 2);
  const finished = advanceDraw(drawn, "draw", Date.parse(timing.startAt) + 60000);
  assert.equal(finished.state, "finished");
  assert.deepEqual(finished.winnerIds, ["a"]);
});

test("a Feestrad without anyone cannot start", () => {
  const session = withGoals(createSession("s", [], 1), [
    { variant: "coffee", participantIds: [] },
    { variant: "water", participantIds: [] },
  ]);
  assert.equal(getCapabilities("host", session).canStartDraw, false);
});

test("a reset keeps the goals", () => {
  const drawn = startDraw(withGoals(createSession("s", people, 1), goals), timing);
  const reset = resetSession(drawn);
  assert.equal(reset.activeDraw, undefined);
  assert.equal(reset.goals?.length, 3);
  assert.equal(reset.winnerCount, 3);
});

test("goals are checked: known people, every person in a goal, each kind once, a word only for koek", () => {
  const base = createSession("s", people, 1);
  const bad: DrawGoal[][] = [
    [{ variant: "coffee", participantIds: ["a", "b", "c", "x"] }],
    [{ variant: "coffee", participantIds: ["a", "b"] }],
    [
      { variant: "coffee", participantIds: ["a", "b"] },
      { variant: "coffee", participantIds: ["c"] },
    ],
    [{ variant: "coffee", title: "taart", participantIds: ["a", "b", "c"] }],
    [{ variant: "cookie", title: "<@U123>", participantIds: ["a", "b", "c"] }],
    [{ variant: "coffee", participantIds: ["a", "b", "c"], weights: [1, 1] }],
    [],
  ];
  for (const goalsList of bad) assert.throws(() => withGoals(base, goalsList));
});

test("rounds without goals keep drawing as before", () => {
  const session = createSession("s", people, 2);
  const drawn = startDraw(session, timing);
  assert.equal(drawn.activeDraw!.spins.length, 2);
  assert.ok(drawn.activeDraw!.spins.every((s) => !s.participantIds));
  assert.deepEqual(wheelParticipants(drawn, 1), people);
});
