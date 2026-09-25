import { test } from "node:test";
import assert from "node:assert/strict";
import { addParticipant } from "../utils/participants";
import { selectRiggedWinners } from "../utils/random";
import { createSession, startDraw } from "../domain/drawEngine";
const people = ["Stefan", "Luca", "Joeri", "Jan", "Tim"].reduce(
  addParticipant,
  [] as import("../domain/models").Participant[],
);
const [stefan, luca, joeri, jan, tim] = people;
test("forced winners always win and are spread over the wheels", () => {
  const wheels = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const winners = selectRiggedWinners(people, 2, { forcedIds: [jan.id] });
    assert.equal(new Set(winners.map((p) => p.id)).size, 2);
    assert.ok(winners.includes(jan));
    wheels.add(winners.indexOf(jan));
  }
  assert.equal(wheels.size, 2);
});
test("more forced winners than wheels picks among the forced only", () => {
  const forced = [luca.id, joeri.id, tim.id];
  const seen = new Set<string>();
  for (let i = 0; i < 300; i++) {
    const [winner] = selectRiggedWinners(people, 1, { forcedIds: forced });
    assert.ok(forced.includes(winner.id));
    seen.add(winner.id);
  }
  assert.equal(seen.size, 3);
});
test("weights shift the odds and zero means never", () => {
  const counts = new Map<string, number>();
  const weights = { [luca.id]: 50, [joeri.id]: 50, [stefan.id]: 0 };
  for (let i = 0; i < 2000; i++) {
    const [winner] = selectRiggedWinners(people, 1, { weights });
    counts.set(winner.id, (counts.get(winner.id) ?? 0) + 1);
  }
  assert.equal(counts.get(stefan.id), undefined);
  assert.ok((counts.get(luca.id) ?? 0) + (counts.get(joeri.id) ?? 0) > 1800);
  // Everyone at zero still yields a valid unique draw.
  const zeros = Object.fromEntries(people.map((p) => [p.id, 0]));
  assert.equal(selectRiggedWinners(people, 3, { weights: zeros }).length, 3);
});
test("rigged draws keep the regular validation and land on the winner", () => {
  assert.throws(() => selectRiggedWinners(people, 6, { forcedIds: [tim.id] }));
  const session = createSession("s", people, 1);
  const drawn = startDraw(
    session,
    { id: "d", startAt: new Date().toISOString() },
    { forcedIds: [stefan.id] },
  );
  assert.equal(drawn.activeDraw!.spins[0].winnerId, stefan.id);
});
