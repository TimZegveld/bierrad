import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../App";
import {
  LocalSessionController,
  type SessionClock,
} from "../sessions/LocalSessionController";
import type { SessionController } from "../sessions/SessionController";
import type { Participant } from "../domain/models";
import { getCapabilities } from "../domain/capabilities";
import {
  createSession,
  eligibleParticipants,
  startSpin,
  finishSpin,
  resetSession,
  wheelParticipants,
} from "../domain/drawEngine";
import { getSpinTiming } from "../domain/spin";

const people: Participant[] = [
  { id: "tim", name: "Tim" },
  { id: "robin", name: "Robin" },
  { id: "sam", name: "Sam" },
];
class FakeClock implements SessionClock {
  time = Date.parse("2026-09-25T13:30:00Z");
  jobs = new Set<{ at: number; callback: () => void }>();
  now = () => this.time;
  schedule = (callback: () => void, delayMs: number) => {
    const job = { at: this.time + delayMs, callback };
    this.jobs.add(job);
    return () => {
      this.jobs.delete(job);
    };
  };
  advance(ms: number) {
    this.time += ms;
    for (const job of [...this.jobs])
      if (job.at <= this.time) {
        this.jobs.delete(job);
        job.callback();
      }
  }
}

test("local controller runs the full manual workflow without a renderer", async () => {
  const clock = new FakeClock();
  let saved: readonly Participant[] = [];
  const controller = new LocalSessionController({
    clock,
    source: { getParticipants: async () => [...saved] },
    saveParticipants: (p) => {
      saved = p;
    },
  });
  await controller.initialize();
  assert.equal(controller.getSnapshot().session.state, "setup");
  await assert.rejects(controller.startFirstSpin());
  await controller.setParticipants(people.slice(0, 1));
  assert.equal(controller.getSnapshot().capabilities.canStartSpin, false);
  await controller.setParticipants(people);
  const original = controller.getSnapshot().session.participants;
  await assert.rejects(controller.startSecondSpin());
  await controller.startFirstSpin();
  const first = controller.getSnapshot().session.spin!;
  assert.ok(people.some((p) => p.id === first.winnerId));
  assert.equal(controller.getSnapshot().session.state, "spinning-first");
  assert.equal(controller.getSnapshot().session.winnerIds.length, 0);
  await assert.rejects(controller.startFirstSpin());
  await assert.rejects(controller.setParticipants([]));
  await assert.rejects(controller.reset());
  await assert.rejects(controller.restoreParticipants());
  clock.advance(first.durationMs - 1);
  assert.equal(controller.getSnapshot().session.state, "spinning-first");
  clock.advance(1);
  assert.equal(controller.getSnapshot().session.state, "first-winner");
  assert.deepEqual(controller.getSnapshot().session.winnerIds, [
    first.winnerId,
  ]);
  clock.advance(30000); // Wait indefinitely for user interaction.
  assert.equal(controller.getSnapshot().session.state, "first-winner");
  await controller.startSecondSpin();
  const second = controller.getSnapshot().session.spin!;
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.winnerId, second.winnerId);
  assert.equal(second.startRotation, first.targetRotation);
  assert.ok(!second.participantIds.includes(first.winnerId));
  clock.advance(second.durationMs);
  assert.equal(controller.getSnapshot().session.state, "finished");
  assert.deepEqual(controller.getSnapshot().session.winnerIds, [
    first.winnerId,
    second.winnerId,
  ]);
  await controller.reset();
  assert.deepEqual(controller.getSnapshot().session.participants, original);
  assert.equal(controller.getSnapshot().session.spin, undefined);
  await controller.newDraw();
  assert.equal(controller.getSnapshot().session.state, "setup");
  await controller.restoreParticipants();
  assert.deepEqual(controller.getSnapshot().session.participants, original);
  controller.dispose();
});

test("two participants leave exactly one eligible second winner", async () => {
  const clock = new FakeClock();
  const controller = new LocalSessionController({ clock });
  await controller.setParticipants(people.slice(0, 2));
  await controller.startFirstSpin();
  clock.advance(4800);
  await controller.startSecondSpin();
  assert.equal(wheelParticipants(controller.getSnapshot().session).length, 1);
  clock.advance(4800);
  assert.equal(new Set(controller.getSnapshot().session.winnerIds).size, 2);
  controller.dispose();
});

test("serialized spin instructions deterministically point at the selected segment", () => {
  for (const winner of people) {
    const session = startSpin(createSession("test", people), winner.id, {
      id: "spin-1",
      startAt: "2026-09-25T13:30:00Z",
      durationMs: 8500,
    });
    const copy = JSON.parse(JSON.stringify(session)) as typeof session;
    const spin = copy.spin!;
    assert.deepEqual(copy.spin, session.spin);
    const index = spin.participantIds.indexOf(winner.id);
    const alignment =
      (spin.targetRotation +
        ((index + 0.5) * 360) / spin.participantIds.length) %
      360;
    assert.ok(Math.min(alignment, 360 - alignment) < 1e-8);
    const deadline = Date.parse(spin.startAt) + spin.durationMs;
    assert.deepEqual(
      finishSpin(copy, spin.id, deadline),
      finishSpin(session, spin.id, deadline),
    );
    assert.equal(finishSpin(session, spin.id, deadline - 1), session);
    assert.equal(finishSpin(session, "stale-spin", deadline), session);
    const finished = finishSpin(session, spin.id, deadline);
    assert.equal(finishSpin(finished, spin.id, deadline), finished);
    assert.throws(() =>
      startSpin(finished, winner.id, {
        id: "spin-2",
        startAt: spin.startAt,
        durationMs: 4800,
      }),
    );
    assert.equal(eligibleParticipants(finished).length, people.length - 1);
    assert.deepEqual(resetSession(finished), createSession("test", people));
  }
});

test("spin timing supports future starts, elapsed playback and completed late joins", () => {
  const session = startSpin(createSession("test", people), people[0].id, {
    id: "spin",
    startAt: "2026-09-25T13:30:00Z",
    durationMs: 8500,
  });
  const spin = session.spin!;
  const start = Date.parse(spin.startAt);
  assert.deepEqual(getSpinTiming(spin, start - 1000), {
    delayMs: 1000,
    elapsedMs: 0,
    finished: false,
  });
  assert.deepEqual(getSpinTiming(spin, start + 3000), {
    delayMs: 0,
    elapsedMs: 3000,
    finished: false,
  });
  assert.deepEqual(getSpinTiming(spin, start + 9000), {
    delayMs: 0,
    elapsedMs: 8500,
    finished: true,
  });
});

test("spectators cannot issue commands even if bypassing disabled UI", async () => {
  const controller = new LocalSessionController({ role: "spectator" });
  const session = createSession("test", people);
  const caps = getCapabilities("spectator", session);
  assert.equal(caps.canViewSession, true);
  assert.equal(caps.canControlSession, false);
  assert.equal(caps.canStartSpin, false);
  assert.equal(caps.canManageParticipants, false);
  assert.equal(caps.canReset, false);
  for (const command of [
    () => controller.startFirstSpin(),
    () => controller.startSecondSpin(),
    () => controller.reset(),
    () => controller.newDraw(),
    () => controller.restoreParticipants(),
    () => controller.setParticipants(people),
  ])
    await assert.rejects(command());
  controller.dispose();
});

test("React can render a foreign controller snapshot with no local authority or random calls", (t) => {
  const ready = createSession("remote-example", people);
  const spinning = startSpin(ready, "tim", {
    id: "external-spin",
    startAt: "2026-09-25T13:30:00Z",
    durationMs: 8500,
  });
  const first = finishSpin(
    spinning,
    "external-spin",
    Date.parse("2026-09-25T13:30:09Z"),
  );
  const second = startSpin(first, "sam", {
    id: "external-spin-2",
    startAt: "2026-09-25T13:30:10Z",
    durationMs: 8500,
  });
  const finished = finishSpin(
    second,
    "external-spin-2",
    Date.parse("2026-09-25T13:30:19Z"),
  );
  t.mock.method(crypto, "getRandomValues", () => {
    throw new Error("Rendering must not choose a winner");
  });
  t.mock.method(crypto, "randomUUID", () => {
    throw new Error("Rendering must not create local instructions");
  });
  const deny = async () => {
    throw new Error("No commands should be called while rendering");
  };
  for (const session of [ready, spinning, first, second, finished]) {
    const snapshot = {
      session,
      capabilities: getCapabilities("spectator", session),
      notice: "",
    };
    const controller: SessionController = {
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
      setParticipants: deny,
      restoreParticipants: deny,
      startFirstSpin: deny,
      startSecondSpin: deny,
      reset: deny,
      newDraw: deny,
    };
    const html = renderToStaticMarkup(createElement(App, { controller }));
    assert.ok(html.includes("Tim"));
    assert.ok(!html.includes('class="primary spin-button"'));
    assert.ok(!html.includes('id="participant"'));
    assert.ok(!html.includes("Opnieuw met dezelfde deelnemers"));
    assert.ok(!html.includes("Alles wissen"));
  }
});

test("snapshot subscription is stable, isolated from callers and removable", async () => {
  const controller = new LocalSessionController();
  assert.equal(controller.getSnapshot(), controller.getSnapshot());
  let updates = 0;
  const unsubscribe = controller.subscribe(() => {
    updates++;
  });
  const mutable = people.map((p) => ({ ...p }));
  await controller.setParticipants(mutable);
  mutable[0].name = "Changed externally";
  assert.equal(controller.getSnapshot().session.participants[0].name, "Tim");
  assert.ok(Object.isFrozen(controller.getSnapshot().session.participants));
  assert.equal(updates, 1);
  unsubscribe();
  await controller.newDraw();
  assert.equal(updates, 1);
  controller.dispose();
});

test("source loading locks mutations and initializes once; disposal cancels timers", async () => {
  let resolve!: (people: Participant[]) => void;
  const loaded = new Promise<Participant[]>((r) => {
    resolve = r;
  });
  const clock = new FakeClock();
  const controller = new LocalSessionController({
    clock,
    source: { getParticipants: () => loaded },
  });
  const initialization = controller.initialize();
  assert.equal(controller.initialize(), initialization);
  assert.equal(
    controller.getSnapshot().capabilities.canManageParticipants,
    false,
  );
  await assert.rejects(controller.setParticipants(people));
  resolve(people);
  await initialization;
  assert.equal(controller.getSnapshot().session.state, "ready");
  await controller.startFirstSpin();
  assert.equal(clock.jobs.size, 1);
  controller.dispose();
  assert.equal(clock.jobs.size, 0);
  await assert.rejects(controller.reset());
});

test("storage failures do not prevent a manual draw and invalid sources cannot alter a roster", async () => {
  const controller = new LocalSessionController({
    source: {
      getParticipants: async () => {
        throw new Error("blocked");
      },
    },
    saveParticipants: () => {
      throw new Error("blocked");
    },
  });
  await controller.initialize();
  assert.match(controller.getSnapshot().notice, /opgeslagen lijst/);
  await controller.setParticipants(people);
  assert.equal(controller.getSnapshot().session.state, "ready");
  assert.match(controller.getSnapshot().notice, /Opslaan/);
  await assert.rejects(controller.setParticipants([people[0], people[0]]));
  assert.deepEqual(controller.getSnapshot().session.participants, people);
  controller.dispose();
});
