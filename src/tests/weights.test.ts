import { test } from "node:test";
import assert from "node:assert/strict";
import { addParticipant, validateParticipants } from "../utils/participants";
import { selectRiggedWinners } from "../utils/random";
import { createSession, startDraw, wheelParticipants } from "../domain/drawEngine";
import { idleRotation, landingRotation, wheelSlices } from "../domain/spin";
import type { Participant } from "../domain/models";

const [alice, bob, carol] = ["Alice", "Bob", "Carol"].reduce(
  addParticipant,
  [] as Participant[],
);
const weighted = [{ ...alice, weight: 3 }, bob, carol];

test("weights size the slices; without them every slice is equal", () => {
  assert.deepEqual(wheelSlices(4), [0, 1, 2, 3].map((i) => ({ start: i / 4, size: 1 / 4 })));
  assert.deepEqual(wheelSlices(3, [3, 1, 1]), [
    { start: 0, size: 0.6 },
    { start: 0.6, size: 0.2 },
    { start: 0.8, size: 0.2 },
  ]);
  assert.equal(idleRotation(0, 3, [3, 1, 1]), 360 - 0.3 * 360);
});

test("a weighted landing stays inside the winner's bigger or smaller slice", () => {
  const weights = [3, 1, 1];
  for (const [index, slice] of wheelSlices(3, weights).entries())
    for (const position of [0.08, 0.5, 0.92]) {
      const rotation = landingRotation(1234, index, 3, 6, position, weights);
      const pointer = ((360 - (rotation % 360)) % 360) / 360;
      assert.ok(pointer > slice.start && pointer < slice.start + slice.size);
    }
});

test("only whole weights from 1 to 100 are accepted, 1 is left out", () => {
  assert.deepEqual(validateParticipants([{ ...alice, weight: 1 }, { ...bob, weight: 100 }]),
    [alice, { ...bob, weight: 100 }]);
  for (const weight of [0, -1, 1.5, 101, Number.NaN])
    assert.throws(() => validateParticipants([{ ...alice, weight }]));
});

test("a bigger slice has proportionally bigger odds", () => {
  let wins = 0;
  const draws = 3000;
  for (let i = 0; i < draws; i++)
    if (selectRiggedWinners(weighted, 1)[0].id === alice.id) wins++;
  // Expected 3/5 = 0.6; the band is more than six standard deviations wide.
  assert.ok(wins / draws > 0.54 && wins / draws < 0.66, String(wins / draws));
});

test("the draw freezes the weights and lands inside the winner's slice", () => {
  const session = createSession("s", weighted, 1);
  for (const winner of weighted) {
    const drawn = startDraw(session, { id: "d", startAt: "2026-10-07T12:00:00.000Z" }, { forcedIds: [winner.id] });
    const draw = drawn.activeDraw!;
    assert.deepEqual(draw.weights, [3, 1, 1]);
    const index = draw.participantIds.indexOf(winner.id);
    const slice = wheelSlices(3, draw.weights)[index];
    const pointer = ((360 - (draw.spins[0].targetRotation % 360)) % 360) / 360;
    assert.ok(pointer > slice.start && pointer < slice.start + slice.size);
    // Replays use the frozen sizes, even if the roster's weights changed since.
    const changed = { ...drawn, participants: drawn.participants.map(({ weight: _, ...p }) => p) };
    assert.deepEqual(wheelParticipants(changed).map((p) => p.weight), [3, undefined, undefined]);
  }
  const plain = startDraw(createSession("s", [alice, bob], 1), { id: "d", startAt: "2026-10-07T12:00:00.000Z" });
  assert.equal(plain.activeDraw!.weights, undefined);
});
