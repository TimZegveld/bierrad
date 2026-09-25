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
  startDraw,
  advanceDraw,
  resetSession,
  wheelParticipants,
} from "../domain/drawEngine";
import { getSpinTiming } from "../domain/spin";
import { LocalWinnerCountPreference } from "../services/WinnerCountPreference";

const people: Participant[] = [
  "Tim",
  "Robin",
  "Sam",
  "Noor",
  "Emma",
  "Joris",
  "Lisa",
  "Peter",
  "Jan",
  "Alex",
].map((name) => ({ id: name.toLowerCase(), name }));
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

test("manual controller selects all winners atomically and reveals at individual deadlines", async () => {
  const clock = new FakeClock();
  const controller = new LocalSessionController({ clock });
  assert.equal(controller.getSnapshot().session.winnerCount, 2);
  await assert.rejects(controller.startDraw());
  await controller.setParticipants(people);
  await controller.setWinnerCount(4);
  const observed: string[] = [];
  controller.subscribe(() => {
    observed.push(controller.getSnapshot().session.state);
  });
  await controller.startDraw();
  const initial = controller.getSnapshot().session;
  assert.equal(initial.state, "spinning");
  assert.equal(initial.activeDraw!.spins.length, 4);
  assert.equal(initial.winnerIds.length, 0);
  assert.deepEqual(observed, ["spinning"]);
  assert.deepEqual(wheelParticipants(initial), people);
  for (const command of [
    () => controller.startDraw(),
    () => controller.setParticipants([]),
    () => controller.setWinnerCount(1),
    () => controller.reset(),
    () => controller.restoreParticipants(),
  ])
    await assert.rejects(command());
  clock.advance(4899); // Shared 100ms lead-in, shortest duration 4800ms.
  assert.equal(controller.getSnapshot().session.winnerIds.length, 0);
  clock.advance(1);
  assert.equal(controller.getSnapshot().session.winnerIds.length, 1);
  assert.equal(controller.getSnapshot().session.state, "spinning");
  clock.advance(449);
  assert.equal(controller.getSnapshot().session.state, "spinning");
  clock.advance(1);
  const final = controller.getSnapshot().session;
  assert.equal(final.state, "finished");
  assert.equal(new Set(final.winnerIds).size, 4);
  assert.equal(final.activeDraw, initial.activeDraw);
  await controller.reset();
  assert.equal(controller.getSnapshot().session.activeDraw, undefined);
  assert.deepEqual(controller.getSnapshot().session.winnerIds, []);
  assert.deepEqual(controller.getSnapshot().session.participants, people);
  assert.equal(controller.getSnapshot().session.winnerCount, 4);
  controller.dispose();
});

test("one participant and one winner are a valid draw", async () => {
  const clock = new FakeClock();
  const controller = new LocalSessionController({ clock });
  await controller.setParticipants(people.slice(0, 1));
  assert.equal(controller.getSnapshot().session.winnerCount, 1);
  await controller.startDraw();
  clock.advance(5000);
  assert.deepEqual(controller.getSnapshot().session.winnerIds, [people[0].id]);
  controller.dispose();
});

test("winner count defaults to two when possible, clamps to roster, and preserves preference", async () => {
  let preferred = 2;
  const controller = new LocalSessionController({
    preference: {
      load: () => preferred,
      save: (n) => {
        preferred = n;
      },
    },
  });
  await controller.setParticipants(people.slice(0, 1));
  assert.equal(controller.getSnapshot().session.winnerCount, 1);
  await controller.setParticipants(people.slice(0, 2));
  assert.equal(controller.getSnapshot().session.winnerCount, 2);
  await controller.setParticipants(people);
  await controller.setWinnerCount(4);
  assert.equal(preferred, 4);
  await controller.setParticipants(people.slice(0, 3));
  assert.equal(controller.getSnapshot().session.winnerCount, 3);
  await controller.setParticipants([]);
  assert.equal(controller.getSnapshot().capabilities.canStartDraw, false);
  await assert.rejects(controller.startDraw());
  await controller.setParticipants(people);
  assert.equal(controller.getSnapshot().session.winnerCount, 4);
  for (const count of [0, 11, 1.1, NaN])
    await assert.rejects(controller.setWinnerCount(count));
  await controller.setWinnerCount(1);
  assert.equal(preferred, 1);
  controller.dispose();
  const restored = new LocalSessionController({
    preference: { load: () => preferred, save: () => {} },
  });
  await restored.setParticipants(people);
  assert.equal(restored.getSnapshot().session.winnerCount, 1);
  restored.dispose();
});

test("one instruction contains N unique results, identical pools and a shared future start", () => {
  for (const count of [1, 2, 3, 4, 5, people.length]) {
    const session = startDraw(createSession("test", people, count), {
      id: "draw",
      startAt: "2030-09-25T13:30:00Z",
    });
    const draw = session.activeDraw!;
    assert.equal(draw.spins.length, count);
    assert.equal(new Set(draw.spins.map((s) => s.winnerId)).size, count);
    assert.equal(new Set(draw.spins.map((s) => s.id)).size, count);
    assert.deepEqual(
      draw.participantIds,
      people.map((p) => p.id),
    );
    for (const [index, spin] of draw.spins.entries()) {
      assert.equal(spin.wheelIndex, index);
      assert.equal(spin.startAt, draw.startAt);
      const winnerIndex = draw.participantIds.indexOf(spin.winnerId);
      assert.ok(winnerIndex >= 0);
      const alignment =
        (spin.targetRotation + ((winnerIndex + 0.5) * 360) / people.length) %
        360;
      assert.ok(Math.min(alignment, 360 - alignment) < 1e-8);
      assert.ok(
        spin.targetRotation >= spin.startRotation + spin.rotations * 360,
      );
    }
    if (count > 1)
      assert.ok(new Set(draw.spins.map((s) => s.durationMs)).size > 1);
    const durations = draw.spins.map((s) => s.durationMs);
    assert.ok(Math.max(...durations) - Math.min(...durations) <= 450);
    const copy = JSON.parse(JSON.stringify(session)) as typeof session;
    const deadline = Date.parse(draw.startAt) + Math.max(...durations);
    assert.deepEqual(
      advanceDraw(copy, draw.id, deadline),
      advanceDraw(session, draw.id, deadline),
    );
    assert.equal(advanceDraw(session, "stale", deadline), session);
    assert.equal(
      advanceDraw(session, draw.id, Date.parse(draw.startAt) - 1),
      session,
    );
    const done = advanceDraw(session, draw.id, deadline);
    assert.equal(advanceDraw(done, draw.id, deadline), done);
    assert.deepEqual(resetSession(done), createSession("test", people, count));
  }
  assert.throws(() =>
    startDraw(
      { ...createSession("bad", people), winnerCount: 11 },
      { id: "bad", startAt: new Date().toISOString() },
    ),
  );
});

test("repeat draw can select exactly the same winners, with new instructions and no exclusions", async (t) => {
  t.mock.method(crypto, "getRandomValues", (array: Uint32Array) => {
    array.fill(0);
    return array;
  });
  const clock = new FakeClock();
  const controller = new LocalSessionController({ clock });
  await controller.setParticipants(people);
  await controller.startDraw();
  clock.advance(6000);
  const previous = controller.getSnapshot().session;
  await controller.startDraw();
  const next = controller.getSnapshot().session;
  assert.notEqual(next.activeDraw!.id, previous.activeDraw!.id);
  assert.deepEqual(
    next.activeDraw!.spins.map((s) => s.winnerId),
    previous.winnerIds,
  );
  assert.deepEqual(next.winnerIds, []);
  next.activeDraw!.spins.forEach((s, i) =>
    assert.equal(s.startRotation, previous.activeDraw!.spins[i].targetRotation),
  );
  clock.advance(6000);
  assert.equal(controller.getSnapshot().session.state, "finished");
  controller.dispose();
});

test("timing supports waiting, partial playback and already-completed draws", () => {
  const spin = startDraw(createSession("test", people), {
    id: "draw",
    startAt: "2026-09-25T13:30:00Z",
  }).activeDraw!.spins[0];
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
    elapsedMs: spin.durationMs,
    finished: true,
  });
});

test("spectators cannot initiate draws or change participants, count, or reset", async () => {
  const controller = new LocalSessionController({ role: "spectator" });
  const caps = getCapabilities("spectator", createSession("test", people));
  assert.equal(caps.canViewSession, true);
  for (const key of [
    "canStartDraw",
    "canConfigureDraw",
    "canManageParticipants",
    "canReset",
    "canControlSession",
  ] as const)
    assert.equal(caps[key], false);
  for (const command of [
    () => controller.startDraw(),
    () => controller.setWinnerCount(1),
    () => controller.reset(),
    () => controller.restoreParticipants(),
    () => controller.setParticipants(people),
  ])
    await assert.rejects(command());
  controller.dispose();
});

test("a spectator renders five server-provided spins without any randomness or local commands", (t) => {
  const ready = createSession("remote-example", people, 5);
  const spinning = startDraw(ready, {
    id: "external",
    startAt: "2026-09-25T13:30:00Z",
  });
  const finished = advanceDraw(
    spinning,
    "external",
    Date.parse("2026-09-25T13:30:10Z"),
  );
  t.mock.method(crypto, "getRandomValues", () => {
    throw new Error("No rendering randomness");
  });
  t.mock.method(crypto, "randomUUID", () => {
    throw new Error("No rendering instructions");
  });
  const deny = async () => {
    throw new Error("No rendering commands");
  };
  for (const session of [ready, spinning, finished]) {
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
      setWinnerCount: deny,
      startDraw: deny,
      reset: deny,
    };
    const html = renderToStaticMarkup(createElement(App, { controller }));
    assert.equal((html.match(/class="wheel-tile"/g) ?? []).length, 5);
    assert.equal((html.match(/Bierrad met 10 deelnemers/g) ?? []).length, 5);
    assert.ok(!html.includes('class="primary spin-button"'));
    assert.ok(!html.includes('id="participant"'));
    assert.ok(!html.includes("Opnieuw draaien"));
    assert.ok(!html.includes("Alles wissen"));
    if (session.state !== "finished") {
      assert.ok(!html.includes("wheel-reveal revealed"));
      assert.ok(!html.includes('class="confetti"'));
    } else {
      assert.equal((html.match(/wheel-reveal revealed/g) ?? []).length, 5);
      assert.ok(html.includes('class="confetti"'));
    }
  }
});

test("subscriptions use stable frozen snapshots and can unsubscribe", async () => {
  const controller = new LocalSessionController();
  assert.equal(controller.getSnapshot(), controller.getSnapshot());
  let updates = 0;
  const unsubscribe = controller.subscribe(() => {
    updates++;
  });
  const mutable = people.map((p) => ({ ...p }));
  await controller.setParticipants(mutable);
  mutable[0].name = "Changed";
  assert.equal(controller.getSnapshot().session.participants[0].name, "Tim");
  assert.ok(Object.isFrozen(controller.getSnapshot().session.participants));
  assert.equal(updates, 1);
  unsubscribe();
  await controller.setParticipants([]);
  assert.equal(updates, 1);
  controller.dispose();
});

test("source loading locks commands, initializes once and disposal cancels draw deadlines", async () => {
  let resolve!: (people: Participant[]) => void;
  const loaded = new Promise<Participant[]>((r) => {
    resolve = r;
  });
  const clock = new FakeClock();
  const controller = new LocalSessionController({
    clock,
    source: { getParticipants: () => loaded },
  });
  const init = controller.initialize();
  assert.equal(controller.initialize(), init);
  await assert.rejects(controller.setParticipants(people));
  await assert.rejects(controller.setWinnerCount(1));
  resolve(people);
  await init;
  assert.equal(controller.getSnapshot().session.state, "ready");
  await controller.startDraw();
  assert.equal(clock.jobs.size, 1);
  controller.dispose();
  assert.equal(clock.jobs.size, 0);
  await assert.rejects(controller.reset());
});

test("storage failure preserves manual use and restored rosters keep the preferred count", async () => {
  let stored: readonly Participant[] = people;
  const controller = new LocalSessionController({
    source: { getParticipants: async () => [...stored] },
    saveParticipants: (p) => {
      stored = p;
    },
    preference: {
      load: () => 3,
      save: () => {
        throw new Error("blocked");
      },
    },
  });
  await controller.initialize();
  assert.equal(controller.getSnapshot().session.winnerCount, 3);
  await controller.setWinnerCount(4);
  assert.match(controller.getSnapshot().notice, /niet worden opgeslagen/);
  await controller.setParticipants([]);
  await controller.restoreParticipants();
  assert.equal(controller.getSnapshot().session.winnerCount, 4);
  await assert.rejects(controller.setParticipants([people[0], people[0]]));
  assert.deepEqual(controller.getSnapshot().session.participants, people);
  controller.dispose();
  const blocked = new LocalSessionController({
    source: {
      getParticipants: async () => {
        throw new Error("blocked");
      },
    },
    saveParticipants: () => {
      throw new Error("blocked");
    },
  });
  await blocked.initialize();
  assert.match(blocked.getSnapshot().notice, /opgeslagen lijst/);
  await blocked.setParticipants(people);
  assert.equal(blocked.getSnapshot().session.state, "ready");
  assert.match(blocked.getSnapshot().notice, /Opslaan/);
  blocked.dispose();
});

test("local winner preference persists values and recovers from invalid stored values", () => {
  let value: string | null = null;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: () => value,
      setItem: (_: string, next: string) => {
        value = next;
      },
    },
  });
  const preference = new LocalWinnerCountPreference();
  assert.equal(preference.load(), 2);
  preference.save(4);
  assert.equal(preference.load(), 4);
  for (const raw of ["bad", "-1", "0", "2.2", "Infinity"]) {
    value = raw;
    assert.equal(preference.load(), 2);
  }
});
