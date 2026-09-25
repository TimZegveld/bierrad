import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { hashSecret, randomHex } from "../auth";
import type {
  CreatedSession,
  PublicBeerWheelSession,
} from "../../shared/protocol";

test(
  "Slack Worker: private starts, authorization, DTO privacy, refresh, disconnected completion and durable idempotency",
  { timeout: 45000 },
  async () => {
    const invite = randomHex(),
      hash = await hashSecret(invite);
    const source = await readFile("worker-dist/index.js", "utf8");
    let posts = 0,
      mode = "success",
      users = ["U00000001", "U00000002"],
      readCalls = 0;
    const sent: Record<string, unknown>[] = [];
    const traces: string[] = [];
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "slack-test",
            modules: true,
            script:
              source +
              `\nexport class TestSession extends LiveSession {
      edit(fn) { const r = JSON.parse(this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value); fn(r); this.ctx.storage.sql.exec('UPDATE session SET value = ? WHERE singleton = 1', JSON.stringify(r)); }
      runCompletion() { return this.alarm(); }
      unlockImport() { this.edit(r => { r.slack.nextImportAt = 0; }); }
      unlockRetry() { this.edit(r => { r.slack.job.retryAt = 0; }); }
      crashRecovery() { this.edit(r => { r.slack.job.status = 'posting'; r.slack.job.attemptedAt = Date.now()-121000; }); return this.alarm(); }
      forceExpire() { this.edit(r => { r.expiresAt = Date.now()-1; }); return this.alarm(); }
      storedRows() { return this.ctx.storage.sql.exec("SELECT count(*) AS n FROM sqlite_master WHERE name = 'session'").one().n; }
    }`,
            compatibilityDate: "2026-09-25",
            compatibilityFlags: ["nodejs_compat"],
            durableObjects: {
              SESSIONS: { className: "TestSession", useSQLite: true },
            },
            bindings: {
              ALLOWED_ORIGINS: "http://127.0.0.1:5173",
              SLACK_BOT_TOKEN: "synthetic-test-credential",
              SLACK_START_GRANT: JSON.stringify({
                hash,
                expiresAt: Date.now() + 600000,
              }),
            },
            ratelimits: {
              CREATION_LIMIT: {
                namespace_id: "10",
                simple: { limit: 100, period: 60 },
              },
              CREATION_GLOBAL: {
                namespace_id: "11",
                simple: { limit: 100, period: 60 },
              },
              REQUEST_LIMIT: {
                namespace_id: "12",
                simple: { limit: 500, period: 60 },
              },
            },
            outboundService: async (req: Request) => {
              const url = new URL(req.url);
              traces.push(url.origin + url.pathname);
              assert.equal(url.origin, "https://slack.com");
              assert.equal(
                req.headers.get("authorization"),
                "Bearer synthetic-test-credential",
              );
              if (url.pathname.endsWith("reactions.get")) {
                readCalls++;
                return Response.json({
                  ok: true,
                  type: "message",
                  channel: "C00000001",
                  message: {
                    ts: "1234567890.123456",
                    reactions: [{ name: "beers", count: users.length, users }],
                  },
                });
              }
              if (url.pathname.endsWith("users.info"))
                return Response.json({
                  ok: true,
                  user: {
                    id: url.searchParams.get("user"),
                    deleted: false,
                    is_bot: false,
                    profile: { display_name: "Alice" },
                  },
                });
              assert.equal(url.pathname, "/api/chat.postMessage");
              posts++;
              sent.push((await req.json()) as Record<string, unknown>);
              if (mode === "reject")
                return Response.json({ ok: false, error: "not_in_channel" });
              if (mode === "uncertain")
                return new Response("", { status: 503 });
              return Response.json({
                ok: true,
                channel: "C00000001",
                ts: "1234567890.999999",
              });
            },
          },
        ],
      }),
    );
    const call = (path: string, cap?: string, body?: object) =>
      mf.dispatchFetch(`http://localhost${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          Origin: "http://127.0.0.1:5173",
          ...(cap ? { Authorization: `Bearer ${cap}` } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const snapshot = async (cap: string) => {
      const r = await call("/api/session", cap);
      assert.equal(r.status, 200);
      return ((await r.json()) as { session: PublicBeerWheelSession }).session;
    };
    try {
      const ordinary = (await (
        await call("/api/sessions", undefined, {})
      ).json()) as CreatedSession;
      assert.equal(
        (await call("/api/slack-sessions", undefined, {})).status,
        404,
      );
      assert.equal(
        (await call("/api/slack-sessions", randomHex(), {})).status,
        404,
      );
      assert.equal(
        (
          await call("/api/command", ordinary.hostCapability, {
            type: "slackImport",
            permalink:
              "https://synthetic.slack.com/archives/C00000001/p1234567890123456",
            revision: 0,
          })
        ).status,
        403,
      );
      const createdResponse = await call("/api/slack-sessions", invite, {});
      assert.equal(createdResponse.status, 201);
      const created = (await createdResponse.json()) as CreatedSession;
      const host = created.hostCapability,
        viewer = created.spectatorCapability;
      const socketResponse = await mf.dispatchFetch(
        "http://localhost/api/socket",
        {
          headers: {
            Origin: "http://127.0.0.1:5173",
            Upgrade: "websocket",
            "Sec-WebSocket-Protocol": `bierrad, auth.${viewer}`,
          },
        },
      );
      assert.equal(socketResponse.status, 101);
      const socket = socketResponse.webSocket!;
      socket.accept();
      const updates: { session?: PublicBeerWheelSession }[] = [];
      socket.addEventListener("message", (event) =>
        updates.push(JSON.parse(String(event.data))),
      );
      const namespace = await mf.getDurableObjectNamespace("SESSIONS");
      const stub = namespace.get(
        namespace.idFromName(host.split(".")[0]),
      ) as unknown as {
        runCompletion(): Promise<void>;
        unlockImport(): Promise<void>;
        unlockRetry(): Promise<void>;
        crashRecovery(): Promise<void>;
        forceExpire(): Promise<void>;
        storedRows(): Promise<number>;
      };
      const command = async (body: object, cap = host) =>
        call("/api/command", cap, {
          ...body,
          revision: (await snapshot(cap)).revision,
        });
      for (const body of [
        { type: "slackImport" },
        { type: "slackManual" },
        { type: "slackRetry" },
      ])
        assert.equal((await command(body, viewer)).status, 403);
      assert.equal(readCalls, 0);
      assert.equal(
        (
          await command({
            type: "slackImport",
            permalink: "https://evil.invalid",
          })
        ).status,
        400,
      );
      const imported = await command({
        type: "slackImport",
        permalink:
          "https://synthetic.slack.com/archives/C00000001/p1234567890123456",
      });
      assert.equal(
        imported.status,
        200,
        imported.status === 200
          ? ""
          : JSON.stringify({ result: await imported.json(), traces }),
      );
      let state = await snapshot(host);
      assert.deepEqual(
        state.participants.map((p) => p.name),
        ["Alice", "Alice (2)"],
      );
      const stableId = state.participants[0].id;
      const hostText = JSON.stringify(state),
        viewerState = await snapshot(viewer);
      for (const secret of [
        "C00000001",
        "U00000001",
        "1234567890.123456",
        "synthetic-test-credential",
        hash,
      ])
        assert.ok(!hostText.includes(secret));
      assert.equal(viewerState.slack, undefined);
      await new Promise((resolve) => setTimeout(resolve, 30));
      const latestUpdate = updates
        .filter((m) => m.session?.participants.length === 2)
        .at(-1);
      assert.ok(latestUpdate);
      assert.equal(latestUpdate.session!.slack, undefined);
      assert.ok(!JSON.stringify(updates).includes("C00000001"));
      socket.close();
      assert.equal((await command({ type: "slackImport" })).status, 429);
      assert.equal(
        (
          await command({
            type: "setParticipants",
            names: ["Alice", "Alice (2)", "Bob"],
          })
        ).status,
        200,
      );
      users = ["U00000001"];
      await stub.unlockImport();
      assert.equal((await command({ type: "slackImport" })).status, 200);
      state = await snapshot(host);
      assert.deepEqual(
        state.participants.map((p) => p.name),
        ["Bob", "Alice"],
      );
      assert.equal(
        state.participants.find((p) => p.name === "Alice")!.id,
        stableId,
      );
      const start = await command({ type: "startDraw" });
      assert.equal(start.status, 200);
      state = await snapshot(host);
      const official = state.activeDraw!.spins.map(
        (sp) => state.participants.find((p) => p.id === sp.winnerId)!.name,
      );
      assert.equal(posts, 0);
      // No browser, socket, polling, or completion callback: only durable alarm runs.
      await new Promise((resolve) => setTimeout(resolve, 8500));
      assert.equal(posts, 1);
      state = await snapshot(host);
      assert.equal(state.state, "finished");
      assert.equal(state.slack?.result?.status, "posted");
      assert.equal(sent[0].thread_ts, "1234567890.123456");
      assert.equal(sent[0].reply_broadcast, false);
      assert.ok(String(sent[0].text).includes(official.join(" · ")));
      await Promise.all([
        stub.runCompletion(),
        stub.runCompletion(),
        stub.runCompletion(),
      ]);
      assert.equal(posts, 1);
      assert.equal((await command({ type: "slackRetry" })).status, 409);
      // A definite rejection is retryable, once; ambiguous delivery never is.
      mode = "reject";
      assert.equal((await command({ type: "startDraw" })).status, 200);
      await new Promise((resolve) => setTimeout(resolve, 8500));
      state = await snapshot(host);
      assert.equal(state.state, "finished");
      assert.equal(state.slack?.result?.status, "failed");
      assert.equal(posts, 2);
      await stub.unlockRetry();
      mode = "success";
      assert.equal((await command({ type: "slackRetry" })).status, 200);
      await stub.runCompletion();
      assert.equal(posts, 3);
      assert.equal((await snapshot(host)).slack?.result?.status, "posted");
      await stub.crashRecovery();
      assert.equal((await snapshot(host)).slack?.result?.status, "uncertain");
      assert.equal((await command({ type: "slackRetry" })).status, 409);
      assert.equal(posts, 3);
      await stub.forceExpire();
      assert.equal((await call("/api/session", host)).status, 404);
      assert.equal(await stub.storedRows(), 0);
    } finally {
      await mf.dispose();
    }
  },
);
