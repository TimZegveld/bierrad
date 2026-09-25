import { test } from "node:test";
import assert from "node:assert/strict";
import { addParticipant, removeParticipant } from "../utils/participants";
import { selectUniqueWinners, randomIndex } from "../utils/random";
import { landingRotation } from "../domain/spin";
import { ManualParticipantSource } from "../services/ManualParticipantSource";
const people = ["Robin", "Tim", "Sam", "Noor"].reduce(
  addParticipant,
  [] as import("../domain/models").Participant[],
);
test("names are trimmed and duplicates cannot be added regardless of case", () => {
  assert.throws(() => addParticipant(people, "  ROBIN "));
  assert.throws(() => addParticipant(people, " "));
  assert.equal(addParticipant([], "  Anne   Marie ")[0].name, "Anne Marie");
});
test("removing a participant preserves the others", () => {
  assert.deepEqual(removeParticipant(people, people[1].id), [
    people[0],
    people[2],
    people[3],
  ]);
});
test("sampling returns exactly N unique members without mutating the pool", () => {
  const original = [...people];
  for (const count of [1, 2, 3, people.length])
    for (let i = 0; i < 50; i++) {
      const winners = selectUniqueWinners(people, count);
      assert.equal(winners.length, count);
      assert.equal(new Set(winners.map((p) => p.id)).size, count);
      assert.ok(winners.every((p) => people.includes(p)));
    }
  assert.deepEqual(people, original);
  for (const count of [0, -1, 1.5, NaN, Infinity, people.length + 1])
    assert.throws(() => selectUniqueWinners(people, count));
  assert.throws(() => selectUniqueWinners([], 1));
  assert.throws(() => selectUniqueWinners([people[0], people[0]], 2));
});

test("Fisher-Yates covers every ordered pair equally for a three-person pool", (t) => {
  let choices: number[] = [];
  t.mock.method(crypto, "getRandomValues", (array: Uint32Array) => {
    array[0] = choices.shift()!;
    return array;
  });
  const outcomes = new Set<string>();
  for (let a = 0; a < 3; a++)
    for (let b = 0; b < 2; b++) {
      choices = [a, b];
      outcomes.add(
        selectUniqueWinners(people.slice(0, 3), 2)
          .map((p) => p.id)
          .join(","),
      );
    }
  assert.equal(outcomes.size, 6);
});

test("rejection sampling discards the biased tail before choosing an index", (t) => {
  let calls = 0;
  t.mock.method(crypto, "getRandomValues", (array: Uint32Array) => {
    array[0] = calls++ === 0 ? 0xffffffff : 1;
    return array;
  });
  assert.equal(randomIndex(3), 1);
  assert.equal(calls, 2);
});

test("rotation lands the predetermined segment center under the top pointer", () => {
  for (const count of [1, 2, 3, 8, 27])
    for (let index = 0; index < count; index++) {
      const rotation = landingRotation(2795, index, count);
      assert.ok(rotation >= 2795 + 2160);
      const alignment = (rotation + ((index + 0.5) * 360) / count) % 360;
      assert.ok(Math.min(alignment, 360 - alignment) < 1e-8);
    }
});
test("manual source restores saved names and rejects corrupted data", async () => {
  let value: string | null = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    },
  });
  const source = new ManualParticipantSource();
  assert.deepEqual(await source.getParticipants(), []);
  source.save(people);
  assert.deepEqual(await source.getParticipants(), people);
  assert.deepEqual(
    (await source.getParticipants()).map((p) => p.name),
    people.map((p) => p.name),
  );
  value = '{"bad":true}';
  await assert.rejects(source.getParticipants());
  value = '[{"name":"Tim"},{"name":"tim"}]';
  await assert.rejects(source.getParticipants());
});
