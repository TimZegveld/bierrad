import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RemoteSessionController,
  seedLiveSession,
} from "../sessions/RemoteSessionController";
import { parseLiveRoute } from "../sessions/liveNavigation";
import { createSession, startDraw } from "../domain/drawEngine";
import type {
  ServerToClientMessage,
  PublicBeerWheelSession,
} from "../../shared/protocol";

class FakeSocket {
  readyState = 0;
  onopen?: () => void;
  onclose?: () => void;
  onerror?: () => void;
  onmessage?: (event: { data: string }) => void;
  send() {}
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  deliver(message: ServerToClientMessage) {
    this.readyState = 1;
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}
const capability = "a".repeat(32) + "." + "b".repeat(64);
function fixture(serverNow: number): PublicBeerWheelSession {
  const local = startDraw(
    createSession(
      "private-internal",
      ["Alice", "Bob", "Charlie"].map((name, i) => ({ id: `p${i}`, name })),
      3,
    ),
    { id: "authoritative", startAt: new Date(serverNow - 2500).toISOString() },
  );
  const { id, mode, scheduledAt, ...safe } = local;
  return {
    ...safe,
    revision: 2,
    expiresAt: new Date(serverNow + 3600000).toISOString(),
  };
}
test("remote late join uses server state and clock offset, rejects spectator commands, never persists participants", async (t) => {
  const serverNow = Date.now() + 60000;
  const dto = { ...fixture(serverNow), variant: "coffee" as const };
  t.mock.method(crypto, "getRandomValues", () => {
    throw new Error("No client winner selection");
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      setItem() {
        throw new Error("No live storage");
      },
    },
  });
  const socket = new FakeSocket();
  const controller = new RemoteSessionController({
    apiUrl: "https://example.invalid",
    role: "spectator",
    capability,
    fetch: (async (_url, options) => {
      assert.equal(
        (options!.headers as Record<string, string>).Authorization,
        `Bearer ${capability}`,
      );
      assert.equal(options!.referrerPolicy, "no-referrer");
      return Response.json({
        type: "snapshot",
        role: "spectator",
        session: dto,
        serverNow,
      });
    }) as typeof fetch,
    socket: (url, protocols) => {
      assert.ok(!url.includes(capability));
      assert.equal(protocols[1], `auth.${capability}`);
      return socket as unknown as WebSocket;
    },
  });
  try {
    await controller.initialize();
    socket.deliver({
      type: "snapshot",
      role: "spectator",
      session: dto,
      serverNow,
    });
    assert.equal(controller.getSnapshot().live?.status, "connected");
    assert.equal(controller.getSnapshot().session.variant, "coffee");
    assert.ok(Math.abs(controller.getSnapshot().clockOffsetMs! - 60000) < 500);
    assert.deepEqual(
      controller.getSnapshot().session.activeDraw,
      dto.activeDraw,
    );
    for (const operation of [
      () => controller.startDraw(),
      () =>
        controller.setScheduledDraw(new Date(serverNow + 60000).toISOString()),
      () => controller.reset(),
      () => controller.setParticipants([]),
      () => controller.setWinnerCount(1),
      () => controller.endSession(),
    ])
      await assert.rejects(operation());
    socket.deliver({
      type: "snapshot",
      role: "spectator",
      session: { ...dto, revision: 1, participants: [] },
      serverNow,
    });
    assert.equal(controller.getSnapshot().session.participants.length, 3);
    socket.deliver({ type: "unavailable" });
    assert.equal(controller.getSnapshot().session.participants.length, 0);
    assert.equal(controller.getSnapshot().session.activeDraw, undefined);
    assert.equal(controller.getSnapshot().session.variant, "coffee");
    assert.equal(controller.getSnapshot().capabilities.canViewSession, false);
  } finally {
    controller.dispose();
  }
});
test("remote reconnect revalidates and retrieves current authoritative snapshot with backoff", async () => {
  let requests = 0;
  const sockets: FakeSocket[] = [];
  const now = Date.now(),
    dto = fixture(now);
  const controller = new RemoteSessionController({
    apiUrl: "https://example.invalid",
    role: "host",
    capability,
    fetch: (async () => {
      requests++;
      return Response.json({
        type: "snapshot",
        role: "host",
        session: dto,
        serverNow: Date.now(),
      });
    }) as typeof fetch,
    socket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
  });
  try {
    await controller.initialize();
    sockets[0].deliver({
      type: "snapshot",
      role: "host",
      session: dto,
      serverNow: now,
    });
    sockets[0].close();
    assert.equal(controller.getSnapshot().live?.status, "reconnecting");
    assert.equal(controller.getSnapshot().capabilities.canStartDraw, false);
    assert.equal(requests, 1);
    await new Promise((r) => setTimeout(r, 1150));
    assert.equal(requests, 2);
    assert.equal(sockets.length, 2);
    sockets[1].deliver({
      type: "snapshot",
      role: "host",
      session: {
        ...dto,
        revision: 3,
        state: "finished",
        winnerIds: dto.activeDraw!.spins.map((s) => s.winnerId),
      },
      serverNow: Date.now(),
    });
    assert.equal(controller.getSnapshot().session.state, "finished");
  } finally {
    controller.dispose();
  }
});
test("invalid access clears state, fragment routes separate host and viewer access", async () => {
  const controller = new RemoteSessionController({
    apiUrl: "https://example.invalid",
    role: "host",
    capability,
    fetch: (async () => new Response(null, { status: 404 })) as typeof fetch,
  });
  await controller.initialize();
  assert.equal(controller.getSnapshot().live?.status, "unavailable");
  controller.dispose();
  assert.equal(parseLiveRoute("#/live/1"), null);
  assert.equal(parseLiveRoute(`#/live/${capability}`)?.role, "spectator");
  assert.equal(
    parseLiveRoute(`#/host/${capability}/${capability}`)?.spectatorCapability,
    capability,
  );
  const words =
    "bier-rad-tulp-kaas-molen-fiets-klomp-haring-dijk-polder-gracht-kade-zon";
  assert.equal(parseLiveRoute(`#/live/${words}`)?.capability, words);
  assert.equal(
    parseLiveRoute(`#/host/${capability}/${words}`)?.spectatorCapability,
    words,
  );
  assert.equal(parseLiveRoute(`#/live/${words}-extra`), null);
  assert.equal(parseLiveRoute(`#/live/Bier-${words.slice(5)}`), null);
  const short = "kaas-molen-tulp-fiets-zon";
  assert.equal(parseLiveRoute(`#/live/${short}`)?.capability, short);
  assert.equal(parseLiveRoute(`#/live/${short}-dijk`), null);
});

test("offline client clears participant data at its server-adjusted expiration", async () => {
  const now = Date.now();
  const dto = { ...fixture(now), expiresAt: new Date(now + 80).toISOString() };
  const socket = new FakeSocket();
  const controller = new RemoteSessionController({
    apiUrl: "https://example.invalid",
    role: "spectator",
    capability,
    fetch: (async () =>
      Response.json({
        type: "snapshot",
        role: "spectator",
        session: dto,
        serverNow: now,
      })) as typeof fetch,
    socket: () => socket as unknown as WebSocket,
  });
  try {
    await controller.initialize();
    socket.deliver({
      type: "snapshot",
      role: "spectator",
      session: dto,
      serverNow: now,
    });
    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 130));
    assert.equal(controller.getSnapshot().session.participants.length, 0);
    assert.equal(controller.getSnapshot().live?.status, "unavailable");
  } finally {
    controller.dispose();
  }
});

test("extended session expiry avoids browser timer overflow and still expires offline", async (t) => {
  const now = Date.now(),
    duration = 30 * 24 * 3600000 + 3600000;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now });
  const dto = {
    ...fixture(now),
    expiresAt: new Date(now + duration).toISOString(),
  };
  const socket = new FakeSocket();
  const controller = new RemoteSessionController({
    apiUrl: "https://example.invalid",
    role: "host",
    capability,
    fetch: (async () =>
      Response.json({
        type: "snapshot",
        role: "host",
        session: dto,
        serverNow: now,
      })) as typeof fetch,
    socket: () => socket as unknown as WebSocket,
  });
  try {
    await controller.initialize();
    socket.deliver({
      type: "snapshot",
      role: "host",
      session: dto,
      serverNow: now,
    });
    t.mock.timers.tick(2147483647);
    assert.equal(controller.getSnapshot().capabilities.canViewSession, true);
    t.mock.timers.tick(duration - 2147483647 + 1);
    assert.equal(controller.getSnapshot().live?.status, "unavailable");
    assert.equal(controller.getSnapshot().session.participants.length, 0);
  } finally {
    controller.dispose();
  }
});

test("a new live session takes over the host's local roster once via host commands", async () => {
  const serverNow = Date.now(),
    socket = new FakeSocket();
  let dto: PublicBeerWheelSession = {
    participants: [],
    winnerCount: 2,
    state: "setup",
    winnerIds: [],
    revision: 0,
    expiresAt: new Date(serverNow + 3600000).toISOString(),
  };
  const bodies: Record<string, unknown>[] = [];
  seedLiveSession(capability, {
    names: ["Alice", "Bob", "Charlie"],
    winnerCount: 3,
  });
  const controller = new RemoteSessionController({
    apiUrl: "https://example.invalid",
    role: "host",
    capability,
    fetch: (async (_url, options) => {
      if (options?.body) {
        const body = JSON.parse(String(options.body));
        bodies.push(body);
        dto =
          body.type === "setParticipants"
            ? {
                ...dto,
                revision: dto.revision + 1,
                participants: body.names.map((name: string, i: number) => ({
                  id: `p${i}`,
                  name,
                })),
              }
            : { ...dto, revision: dto.revision + 1, winnerCount: body.count };
      }
      return Response.json({
        type: "snapshot",
        role: "host",
        session: dto,
        serverNow,
      });
    }) as typeof fetch,
    socket: () => socket as unknown as WebSocket,
  });
  try {
    await controller.initialize();
    socket.deliver({ type: "snapshot", role: "host", session: dto, serverNow });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      bodies.map((b) => b.type),
      ["setParticipants", "setWinnerCount"],
    );
    assert.deepEqual(bodies[0].names, ["Alice", "Bob", "Charlie"]);
    assert.equal(controller.getSnapshot().session.winnerCount, 3);
    socket.deliver({
      type: "snapshot",
      role: "host",
      session: { ...dto, participants: [], revision: 9 },
      serverNow,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(bodies.length, 2, "the roster is handed over only once");
  } finally {
    controller.dispose();
  }
});
