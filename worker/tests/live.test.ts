import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { randomHex, hashSecret, parseCapability } from "../auth";
import {
  newSession,
  mutate,
  advance,
  publicSession,
  TTL_MS,
  nextDeadline,
} from "../session";
import type {
  CreatedSession,
  ServerToClientMessage,
} from "../../shared/protocol";

test("capabilities use 256 secure random bits and hashes; DTO is explicitly minimized", async (t) => {
  let bytes = 0;
  const original = crypto.getRandomValues.bind(crypto);
  t.mock.method(crypto, "getRandomValues", (array: Uint8Array) => {
    bytes += array.byteLength;
    return original(array);
  });
  const host = randomHex(),
    spectator = randomHex();
  assert.equal(bytes, 64);
  assert.notEqual(host, spectator);
  const record = newSession(
    await hashSecret(host),
    await hashSecret(spectator),
    Date.now(),
  );
  assert.equal(record.expiresAt - record.createdAt, TTL_MS);
  assert.notEqual(record.hostHash, host);
  const dto = publicSession(record);
  assert.deepEqual(
    Object.keys(dto).sort(),
    [
      "participants",
      "winnerCount",
      "state",
      "winnerIds",
      "expiresAt",
      "revision",
    ].sort(),
  );
  assert.ok(!JSON.stringify(dto).includes(host));
  assert.ok(!JSON.stringify(dto).includes(record.hostHash));
  assert.ok(!JSON.stringify(dto).includes(record.session.id));
  assert.equal(parseCapability("sequential-1"), null);
});

test("server domain validates inputs, locks draws, advances by time and allows independent repeats", () => {
  const now = Date.now();
  const r = newSession("host", "spectator", now);
  const command = (c: object, at = now) =>
    mutate(r, "host", { ...c, revision: r.revision }, at);
  assert.equal(r.session.winnerCount, 2);
  command({
    type: "setParticipants",
    names: ["Alice", "Bob", "Charlie", "Dana"],
  });
  const initialId = r.session.participants[0].id;
  assert.throws(() =>
    command({ type: "setParticipants", names: ["ALICE", "alice"] }),
  );
  assert.throws(() =>
    command({ type: "setParticipants", names: ["x".repeat(33)] }),
  );
  assert.throws(() => command({ type: "setWinnerCount", count: 5 }));
  assert.throws(() => command({ type: "startDraw", winner: "Alice" }));
  command({ type: "setWinnerCount", count: 4 });
  command({ type: "setParticipants", names: ["Alice", "Bob", "Charlie"] });
  assert.equal(r.session.winnerCount, 3);
  assert.equal(r.session.participants[0].id, initialId);
  command({ type: "startDraw" });
  const draw = r.session.activeDraw!;
  assert.equal(draw.spins.length, 3);
  assert.equal(new Set(draw.spins.map((s) => s.winnerId)).size, 3);
  assert.equal(Date.parse(draw.startAt), now + 2000);
  assert.equal(nextDeadline(r), now + 2000);
  assert.equal(r.session.state, "countdown");
  for (const spin of draw.spins) {
    assert.equal(spin.startAt, draw.startAt);
    const index = draw.participantIds.indexOf(spin.winnerId);
    assert.ok(index >= 0);
    const alignment = (spin.targetRotation + ((index + 0.5) * 360) / 3) % 360;
    assert.ok(Math.min(alignment, 360 - alignment) < 1e-8);
  }
  assert.throws(() => command({ type: "reset" }));
  assert.throws(() => command({ type: "setParticipants", names: [] }));
  advance(r, now + 5000);
  assert.equal(r.session.state, "spinning");
  advance(r, now + 8000);
  assert.equal(r.session.state, "finished");
  assert.equal(r.session.winnerIds.length, 3);
  command({ type: "startDraw" }, now + 9000);
  assert.deepEqual(
    new Set(r.session.activeDraw!.spins.map((s) => s.winnerId)),
    new Set(draw.spins.map((s) => s.winnerId)),
  );
  advance(r, now + 17000);
  command({ type: "reset" }, now + 17000);
  assert.equal(r.session.activeDraw, undefined);
  assert.deepEqual(r.session.winnerIds, []);
  assert.throws(() => command({ type: "startDraw" }, now + TTL_MS));
});

test(
  "actual Worker and SQLite Durable Object enforce authorization, broadcast, reconnect and erase expiry",
  { timeout: 40000 },
  async () => {
    const source = await readFile("worker-dist/index.js", "utf8");
    // Test-only subclass: never exported from the production Worker.
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "bierrad-test",
            modules: true,
            script:
              source +
              `\nexport class TestSession extends LiveSession {
    async forceExpire() {
      const row = this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one();
      const r = JSON.parse(row.value); r.expiresAt = Date.now() - 1;
      this.ctx.storage.sql.exec('UPDATE session SET value = ? WHERE singleton = 1', JSON.stringify(r));
      await this.alarm();
    }
    storedRows() { return this.ctx.storage.sql.exec("SELECT count(*) AS n FROM sqlite_master WHERE name = 'session'").one().n; }
  }`,
            compatibilityDate: "2026-09-25",
            compatibilityFlags: ["nodejs_compat"],
            durableObjects: {
              SESSIONS: { className: "TestSession", useSQLite: true },
            },
            bindings: { ALLOWED_ORIGINS: "http://127.0.0.1:5173" },
            ratelimits: {
              CREATION_LIMIT: {
                namespace_id: "1",
                simple: { limit: 5, period: 60 },
              },
              CREATION_GLOBAL: {
                namespace_id: "2",
                simple: { limit: 60, period: 60 },
              },
              REQUEST_LIMIT: {
                namespace_id: "3",
                simple: { limit: 240, period: 60 },
              },
            },
          },
        ],
      }),
    );
    const sockets: { close(): void }[] = [];
    try {
      const origin = "http://127.0.0.1:5173";
      const call = (
        path: string,
        cap?: string,
        body?: unknown,
        extra: Record<string, string> = {},
      ) =>
        mf.dispatchFetch(`http://localhost${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Origin: origin,
            ...(cap ? { Authorization: `Bearer ${cap}` } : {}),
            ...(body !== undefined
              ? { "Content-Type": "application/json" }
              : {}),
            ...extra,
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
      const createdResponse = await call("/api/sessions", undefined, {});
      assert.equal(createdResponse.status, 201);
      assert.equal(
        createdResponse.headers.get("cache-control"),
        "no-store, private",
      );
      const created = (await createdResponse.json()) as CreatedSession;
      assert.notEqual(created.hostCapability, created.spectatorCapability);
      for (const path of [
        "/api/sessions",
        "/api/participants",
        "/api/active-sessions",
        "/api/session",
      ])
        assert.equal((await call(path)).status, 404);
      const invalid = created.hostCapability.slice(0, 33) + "0".repeat(64);
      assert.equal((await call("/api/session", invalid)).status, 404);
      assert.equal(
        (
          await call("/api/session", created.hostCapability, undefined, {
            Origin: "https://evil.invalid",
          })
        ).status,
        403,
      );
      const initial = (await (
        await call("/api/session", created.hostCapability)
      ).json()) as Extract<ServerToClientMessage, { type: "snapshot" }>;
      let revision = initial.session.revision;
      for (const command of [
        { type: "setParticipants", names: ["Alice"] },
        { type: "setParticipants", names: [] },
        { type: "setWinnerCount", count: 1 },
        { type: "startDraw" },
        { type: "reset" },
        { type: "endSession" },
      ])
        assert.equal(
          (
            await call("/api/command", created.spectatorCapability, {
              ...command,
              revision,
            })
          ).status,
          403,
        );
      const connect = async (cap: string) => {
        const res = await call("/api/socket", undefined, undefined, {
          Upgrade: "websocket",
          "Sec-WebSocket-Protocol": `bierrad, auth.${cap}`,
        });
        assert.equal(res.status, 101);
        const ws = res.webSocket!;
        const messages: ServerToClientMessage[] = [];
        ws.addEventListener("message", (e) =>
          messages.push(JSON.parse(String(e.data))),
        );
        ws.accept();
        sockets.push(ws);
        return { ws, messages };
      };
      assert.equal(
        (
          await call("/api/socket", undefined, undefined, {
            Upgrade: "websocket",
            "Sec-WebSocket-Protocol": `bierrad, auth.${invalid}`,
          })
        ).status,
        404,
      );
      const a = await connect(created.hostCapability),
        b = await connect(created.spectatorCapability),
        c = await connect(created.spectatorCapability);
      const waitFor = async (check: () => boolean) => {
        const start = Date.now();
        while (!check()) {
          if (Date.now() - start > 12000)
            throw new Error("Timed out waiting for safe test state");
          await new Promise((r) => setTimeout(r, 20));
        }
      };
      await waitFor(() => b.messages.some((m) => m.type === "snapshot"));
      b.ws.send(JSON.stringify({ type: "startDraw", winner: "Alice" }));
      await waitFor(() =>
        b.messages.some((m) => m.type === "error" && m.code === "forbidden"),
      );
      const host = async (command: object) => {
        const response = await call("/api/command", created.hostCapability, {
          ...command,
          revision,
        });
        assert.equal(response.status, 200);
        const message = (await response.json()) as Extract<
          ServerToClientMessage,
          { type: "snapshot" }
        >;
        revision = message.session.revision;
        return message;
      };
      await host({
        type: "setParticipants",
        names: [
          "Alice",
          "Bob",
          "Charlie",
          "Dana",
          "Eve",
          "Frank",
          "Grace",
          "Helen",
        ],
      });
      await waitFor(() =>
        [b, c].every((client) =>
          client.messages.some(
            (m) => m.type === "snapshot" && m.session.participants.length === 8,
          ),
        ),
      );
      await host({ type: "setWinnerCount", count: 3 });
      const started = await host({ type: "startDraw" });
      const draw = started.session.activeDraw!;
      await waitFor(() =>
        [a, b, c].every((client) =>
          client.messages.some(
            (m) =>
              m.type === "snapshot" && m.session.activeDraw?.id === draw.id,
          ),
        ),
      );
      for (const client of [a, b, c]) {
        const message = client.messages.find(
          (m) => m.type === "snapshot" && m.session.activeDraw?.id === draw.id,
        ) as typeof started;
        assert.deepEqual(message.session.activeDraw, draw);
        assert.ok(!JSON.stringify(message).includes(created.hostCapability));
      }
      await new Promise((r) => setTimeout(r, 3000));
      const late = await connect(created.spectatorCapability);
      await waitFor(() =>
        late.messages.some(
          (m) => m.type === "snapshot" && m.session.state === "spinning",
        ),
      );
      const lateState = late.messages.find(
        (m) => m.type === "snapshot",
      ) as typeof started;
      assert.deepEqual(lateState.session.activeDraw, draw);
      assert.ok(lateState.serverNow > Date.parse(draw.startAt));
      a.ws.close(); // Host absence cannot prevent official completion.
      await waitFor(() =>
        c.messages.some(
          (m) => m.type === "snapshot" && m.session.state === "finished",
        ),
      );
      const final = (await (
        await call("/api/session", created.hostCapability)
      ).json()) as typeof started;
      revision = final.session.revision;
      assert.equal(new Set(final.session.winnerIds).size, 3);
      await host({ type: "reset" });
      await waitFor(() =>
        c.messages.some(
          (m) =>
            m.type === "snapshot" &&
            m.session.revision === revision &&
            !m.session.activeDraw,
        ),
      );
      const namespace = await mf.getDurableObjectNamespace("SESSIONS");
      const stub = namespace.get(
        namespace.idFromName(parseCapability(created.hostCapability)!.locator),
      );
      await (
        stub as typeof stub & { forceExpire(): Promise<void> }
      ).forceExpire();
      await waitFor(() => c.messages.some((m) => m.type === "unavailable"));
      for (const cap of [created.hostCapability, created.spectatorCapability]) {
        const expired = await call("/api/session", cap);
        assert.equal(expired.status, 404);
        assert.ok(!(await expired.text()).includes("Alice"));
      }
      assert.equal(
        await (
          stub as typeof stub & { storedRows(): Promise<number> }
        ).storedRows(),
        0,
      );
      let limited = false;
      for (let i = 0; i < 7; i++)
        if ((await call("/api/sessions", undefined, {})).status === 429)
          limited = true;
      assert.ok(limited);
    } finally {
      for (const ws of sockets)
        try {
          ws.close();
        } catch {}
      await mf.dispose();
    }
  },
);
