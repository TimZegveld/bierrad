import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, startDraw, withGoals } from "../domain/drawEngine";
import { feestLines } from "../domain/presentation";
import { feestTheme, themes } from "../../shared/variant";

const people = [
  { id: "a", name: "Alice" },
  { id: "b", name: "Bob" },
  { id: "c", name: "Carol" },
];
const timing = { id: "draw", startAt: "2026-10-13T12:00:00.000Z" };

test("a Feestrad result names each winner with their goal, in wheel order", () => {
  const session = startDraw(
    withGoals(createSession("s", people, 1), [
      { variant: "coffee", participantIds: ["a", "b"] },
      { variant: "water", participantIds: ["a"] },
      { variant: "cookie", title: "taart", participantIds: ["c"] },
    ]),
    timing,
  );
  const winners = session.activeDraw!.spins.map((s) => people.find((p) => p.id === s.winnerId)!);
  assert.deepEqual(feestLines(session, winners), [
    { id: "b", icon: "☕", line: "Bob haalt koffie" },
    { id: "a", icon: "💧", line: "Alice haalt water" },
    { id: "c", icon: "🍪", line: "Carol haalt taart" },
  ]);
});

test("rounds with one goal keep their own result text", () => {
  const session = startDraw(createSession("s", people, 2), timing);
  assert.equal(feestLines(session, people.slice(0, 2)), undefined);
});

test("the Feestrad theme is its own rainbow, never another wheel's colours", () => {
  assert.equal(feestTheme.name, "Feestrad");
  assert.equal(new Set(feestTheme.wheelColors).size, 8);
  for (const theme of Object.values(themes))
    assert.notDeepEqual(theme.wheelColors, feestTheme.wheelColors);
});
