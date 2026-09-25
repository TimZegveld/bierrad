import { test } from "node:test";
import assert from "node:assert/strict";
import { addParticipant, removeParticipant } from "../utils/participants";
import { pickWinner } from "../utils/random";
import { landingRotation } from "../domain/spin";
import { ManualParticipantSource } from "../services/ManualParticipantSource";
const people = ["Robin", "Tim", "Sam", "Noor"].reduce(
  addParticipant,
  [] as import("../types").Participant[],
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
test("random winner always belongs to the participants", () => {
  for (let i = 0; i < 200; i++) assert.ok(people.includes(pickWinner(people)));
  assert.throws(() => pickWinner([]));
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
