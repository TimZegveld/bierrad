import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bestWheelColumns,
  COUNTDOWN_LEAD_MS,
  countdownDigit,
  countLabel,
  joinNames,
  spectatorPresentation,
  timeLeftLabel,
  wheelColumns,
} from "../domain/presentation";
import {
  advanceDraw,
  createSession,
  resetSession,
  startDraw,
  wheelCount,
} from "../domain/drawEngine";
import { getCapabilities } from "../domain/capabilities";
import {
  idleRotation,
  landingMargin,
  pegsPassed,
  unwrapRotation,
} from "../domain/spin";
import { addParticipant } from "../utils/participants";
import type { Participant } from "../domain/models";

const now = Date.parse("2026-10-02T13:45:00Z");
const people = ["Robin", "Tim", "Sam", "Noor", "Eva"].reduce(
  addParticipant,
  [] as Participant[],
);
const ready = createSession("s", people, 2);
const drawn = startDraw(ready, {
  id: "d",
  startAt: new Date(now + 4000).toISOString(),
});
const draw = drawn.activeDraw!;
const end = (i: number) => Date.parse(draw.startAt) + draw.spins[i].durationMs;

test("summary uses Dutch singular and plural", () => {
  assert.equal(countLabel(1, "bierhaler", "bierhalers"), "1 bierhaler");
  assert.equal(countLabel(2, "bierhaler", "bierhalers"), "2 bierhalers");
  assert.equal(countLabel(1, "deelnemer", "deelnemers"), "1 deelnemer");
  assert.equal(countLabel(15, "deelnemer", "deelnemers"), "15 deelnemers");
});

test("winner names join naturally and are never shortened", () => {
  const long = "Anne-Marie van den Berg-Vijverberg";
  assert.equal(joinNames([long]), long);
  assert.equal(joinNames(["Jan", "Rob"]), "Jan & Rob");
  assert.equal(joinNames(["Jan", "Rob", "Lisa"]), "Jan, Rob & Lisa");
  assert.equal(joinNames([]), "");
});

test("waiting and empty states without a draw", () => {
  assert.equal(spectatorPresentation(ready, undefined, now).phase, "waiting");
  assert.equal(
    spectatorPresentation(createSession("e"), undefined, now).phase,
    "empty",
  );
});

test("a planned start counts down from the authoritative startAt", () => {
  const startAt = now + 60000;
  const plan = {
    startAt: new Date(startAt).toISOString(),
    status: "pending",
  } as const;
  const waiting = spectatorPresentation(ready, plan, now);
  assert.equal(waiting.phase, "waiting");
  assert.equal(waiting.startAt, startAt);
  assert.equal(waiting.nextChangeAt, startAt - COUNTDOWN_LEAD_MS);
  const counting = spectatorPresentation(
    ready,
    plan,
    startAt - COUNTDOWN_LEAD_MS,
  );
  assert.equal(counting.phase, "countdown");
  assert.equal(counting.startAt, startAt);
  // The server's final check means the draw is about to be issued.
  assert.equal(
    spectatorPresentation(ready, { ...plan, status: "refreshing" }, now).phase,
    "countdown",
  );
  const skipped = spectatorPresentation(
    ready,
    { ...plan, status: "skipped" },
    startAt + 1000,
  );
  assert.equal(skipped.phase, "waiting");
  assert.ok(skipped.skipped);
});

test("countdown digits follow the remaining server time", () => {
  assert.equal(countdownDigit(9000), undefined);
  assert.equal(countdownDigit(3000), 3);
  assert.equal(countdownDigit(2001), 3);
  assert.equal(countdownDigit(1500), 2);
  assert.equal(countdownDigit(1), 1);
  assert.equal(countdownDigit(0), 0);
  assert.equal(countdownDigit(-500), 0);
});

test("time left counts down in minutes and seconds within the last hour", () => {
  assert.equal(timeLeftLabel(134000), "2:14");
  assert.equal(timeLeftLabel(133001), "2:14");
  assert.equal(timeLeftLabel(60000), "1:00");
  assert.equal(timeLeftLabel(9500), "0:10");
  assert.equal(timeLeftLabel(3600000), "60:00");
  assert.equal(timeLeftLabel(3600001), undefined);
  assert.equal(timeLeftLabel(0), undefined);
  assert.equal(timeLeftLabel(-1), undefined);
});

test("draw phases derive from the instruction for late joiners and reconnects", () => {
  const before = spectatorPresentation(drawn, undefined, now + 1000);
  assert.equal(before.phase, "countdown");
  assert.equal(before.startAt, Date.parse(draw.startAt));
  assert.equal(before.nextChangeAt, Date.parse(draw.startAt));
  // Joining mid-spin: no replay, straight into the spinning phase.
  assert.equal(
    spectatorPresentation(drawn, undefined, now + 6000).phase,
    "spinning",
  );
  // One wheel revealed by the server while the other still spins.
  const partial = advanceDraw(drawn, "d", end(0));
  assert.equal(partial.winnerIds.length, 1);
  assert.equal(partial.winnerIds[0], draw.spins[0].winnerId);
  assert.equal(
    spectatorPresentation(partial, undefined, end(0)).phase,
    "spinning",
  );
  // Reconnecting long after completion restores the result immediately.
  const finished = advanceDraw(drawn, "d", end(1));
  assert.equal(finished.state, "finished");
  assert.deepEqual(
    finished.winnerIds,
    draw.spins.map((spin) => spin.winnerId),
  );
  assert.equal(
    spectatorPresentation(finished, undefined, end(1) + 3600000).phase,
    "result",
  );
  assert.equal(
    spectatorPresentation(resetSession(finished), undefined, now).phase,
    "waiting",
  );
});

test("spectators keep zero control capabilities in every phase", () => {
  for (const session of [ready, drawn, advanceDraw(drawn, "d", end(1))]) {
    const caps = getCapabilities("spectator", session);
    assert.ok(caps.canViewSession);
    assert.ok(
      !caps.canControlSession &&
        !caps.canManageParticipants &&
        !caps.canConfigureDraw &&
        !caps.canStartDraw &&
        !caps.canReset,
    );
  }
});

test("wheel grid columns stay readable for 1 to 8 wheels", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7, 8].map(wheelColumns),
    [1, 2, 3, 2, 3, 3, 4, 4],
  );
  assert.equal(wheelCount(createSession("e")), 1);
  assert.equal(wheelCount(ready), 2);
  assert.equal(wheelCount(drawn), draw.spins.length);
});

test("wheels rest at distinct deterministic slices without changing the landing", () => {
  const rests = [0, 1, 2, 3].map((i) => idleRotation(i, 15));
  assert.equal(new Set(rests).size, 4);
  assert.deepEqual(
    rests,
    [0, 1, 2, 3].map((i) => idleRotation(i, 15)),
  );
  for (const rest of rests) assert.ok(rest >= 0 && rest < 360);
  // The first spin starts exactly where the resting wheel is drawn.
  draw.spins.forEach((spin, i) => {
    assert.equal(spin.startRotation, idleRotation(i, people.length));
    const index = draw.participantIds.indexOf(spin.winnerId);
    const step = 360 / people.length;
    const position =
      (((-spin.targetRotation % 360) + 360) % 360) / step - index;
    const margin = landingMargin(people.length);
    assert.ok(position >= margin - 1e-9 && position <= 1 - margin + 1e-9);
  });
  assert.equal(idleRotation(0, 0), 0);
});

test("measured stages choose the grid with the largest wheels", () => {
  // 16:9 TV stage: four wheels fit larger in one row than in 2×2.
  assert.equal(bestWheelColumns(4, 1824, 720, 56), 4);
  assert.equal(bestWheelColumns(2, 1824, 720, 56), 2);
  assert.equal(bestWheelColumns(1, 1824, 720, 56), 1);
  // A tall, narrow stage stacks them instead.
  assert.equal(bestWheelColumns(4, 900, 1200, 30), 2);
  assert.equal(bestWheelColumns(2, 700, 1300, 20), 1);
  // Unmeasured stages fall back to the default table.
  assert.equal(bestWheelColumns(4, 0, 0, 20), wheelColumns(4));
});
test("pointer ticks once per rim peg, in either direction and across the 180° wrap", () => {
  assert.equal(pegsPassed(0, 11, 32), 0);
  assert.equal(pegsPassed(0, 11.25, 32), 1);
  assert.equal(pegsPassed(5, 360 + 5, 32), 32);
  assert.equal(pegsPassed(-1, 1, 32), 1);
  assert.equal(pegsPassed(30, 10, 32), 2);
  assert.equal(unwrapRotation(170, -170), 190);
  assert.equal(unwrapRotation(720 + 179, -179), 720 + 181);
  assert.equal(unwrapRotation(10, 5), 5);
});
