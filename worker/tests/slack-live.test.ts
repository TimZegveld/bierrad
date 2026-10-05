import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { hashSecret, randomHex } from "../auth";
import type {
  CreatedSession,
  PublicBeerWheelSession,
} from "../../shared/protocol";

for (const variant of ["beer", "coffee", "water"] as const)
  test(
    `${variant} Slack Worker: Sign in with Slack starts, authorization, DTO privacy, refresh, disconnected completion and durable idempotency`,
    { timeout: 50000 },
    async () => {
      const reaction = { beer: "beers", coffee: "coffee", water: "droplet" }[
        variant
      ];
      // Water shares the Koffierad app; beer has its own.
      const coffeeApp = variant !== "beer";
      const credential = `synthetic-${variant}-credential`;
      const clientId = "1000000000.2000000000",
        clientSecret = `synthetic-${variant}-client-secret`;
      const legacyHash = await hashSecret(randomHex());
      let nonce = "",
        loginUser: Record<string, unknown> = {};
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
      shortExpiry() { this.edit(r => { r.expiresAt = Date.now() + 30000; }); }
      ceiling(ms) { this.edit(r => { r.slack.grantExpiresAt = Date.now() + ms; }); }
      legacyGrant(hash) { this.edit(r => { r.slack.grantHash = hash; delete r.slack.grantExpiresAt; }); }
      loginGrant() { this.edit(r => { r.slack.grantHash = "slack-login"; r.slack.grantExpiresAt = Date.now() + 31 * 24 * 3600000; }); }
      revokeGrant() { this.edit(r => { r.slack.grantHash = "revoked-synthetic"; }); }
      unlockImport() { this.edit(r => { r.slack.nextImportAt = 0; r.slack.nextFinalImportAt = 0; r.slack.retryImportAt = 0; }); }
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
                FRONTEND_URL: "http://127.0.0.1:5173/",
                [coffeeApp
                  ? "SLACK_BOT_TOKEN"
                  : "COFFEE_SLACK_BOT_TOKEN"]: "synthetic-other-app",
                [coffeeApp
                  ? "SLACK_CLIENT_ID"
                  : "COFFEE_SLACK_CLIENT_ID"]: "1000000000.3000000000",
                [coffeeApp
                  ? "SLACK_CLIENT_SECRET"
                  : "COFFEE_SLACK_CLIENT_SECRET"]:
                  "synthetic-other-client-secret",
                [coffeeApp
                  ? "COFFEE_SLACK_BOT_TOKEN"
                  : "SLACK_BOT_TOKEN"]: credential,
                [coffeeApp
                  ? "COFFEE_SLACK_CLIENT_ID"
                  : "SLACK_CLIENT_ID"]: clientId,
                [coffeeApp
                  ? "COFFEE_SLACK_CLIENT_SECRET"
                  : "SLACK_CLIENT_SECRET"]: clientSecret,
                // A leftover start-link secret must not revive legacy sessions.
                [coffeeApp
                  ? "COFFEE_SLACK_START_GRANT"
                  : "SLACK_START_GRANT"]: JSON.stringify({
                  hash: legacyHash,
                  expiresAt: Date.now() + 3 * 24 * 3600000,
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
                if (url.pathname === "/api/openid.connect.token") {
                  assert.equal(req.headers.get("authorization"), null);
                  const form = new URLSearchParams(await req.text());
                  assert.equal(form.get("client_id"), clientId);
                  assert.equal(form.get("client_secret"), clientSecret);
                  assert.equal(form.get("code"), "synthetic-code");
                  assert.equal(
                    form.get("redirect_uri"),
                    "http://localhost/auth/slack/callback",
                  );
                  const part = (v: object) =>
                    btoa(JSON.stringify(v)).replace(/=+$/, "");
                  return Response.json({
                    ok: true,
                    access_token: "synthetic-user-credential",
                    id_token: `${part({})}.${part({
                      iss: "https://slack.com",
                      aud: clientId,
                      exp: Math.floor(Date.now() / 1000) + 300,
                      nonce,
                      sub: "U00000007",
                      "https://slack.com/team_id": "T00000001",
                    })}.c2ln`,
                  });
                }
                if (url.pathname === "/api/auth.revoke") {
                  assert.equal(
                    req.headers.get("authorization"),
                    "Bearer synthetic-user-credential",
                  );
                  return Response.json({ ok: true, revoked: true });
                }
                assert.equal(
                  req.headers.get("authorization"),
                  `Bearer ${credential}`,
                );
                if (url.pathname === "/api/auth.test")
                  return Response.json({ ok: true, team_id: "T00000001" });
                if (url.pathname.endsWith("reactions.get")) {
                  readCalls++;
                  if (mode === "read-reject")
                    return Response.json({
                      ok: false,
                      error: "not_in_channel",
                    });
                  return Response.json({
                    ok: true,
                    type: "message",
                    channel: "C00000001",
                    message: {
                      ts: "1234567890.123456",
                      reactions: [
                        { name: reaction, count: users.length, users },
                        // Other variants' reactions never count.
                        ...["beers", "coffee", "droplet"]
                          .filter((name) => name !== reaction)
                          .map((name) => ({
                            name,
                            count: 1,
                            users: ["U00000009"],
                          })),
                      ],
                    },
                  });
                }
                if (url.pathname.endsWith("users.info"))
                  return Response.json({
                    ok: true,
                    user: {
                      id: url.searchParams.get("user"),
                      team_id: "T00000001",
                      deleted: false,
                      is_bot: false,
                      profile: { display_name: "Alice" },
                      ...(url.searchParams.get("user") === "U00000007"
                        ? loginUser
                        : {}),
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
        return ((await r.json()) as { session: PublicBeerWheelSession })
          .session;
      };
      try {
        const ordinary = (await (
          await call("/api/sessions", undefined, { variant })
        ).json()) as CreatedSession;
        // Start links are gone: every bearer variant of the old endpoint is closed.
        for (const cap of [undefined, randomHex()])
          assert.equal(
            (await call("/api/slack-sessions", cap, { variant })).status,
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
        for (const invalid of [
          { variant: "tea" },
          { variant: null },
          { variant, token: "bad" },
        ])
          assert.equal(
            (await call("/api/sessions", undefined, invalid)).status,
            400,
          );
        const prefix = variant === "beer" ? "" : `${variant}-`;
        const navigate = (path: string, cookie?: string) =>
          mf.dispatchFetch(`http://localhost${path}`, {
            redirect: "manual",
            headers: cookie ? { Cookie: cookie } : {},
          });
        const login = async () => {
          const begin = await navigate(`/auth/slack/${variant}`);
          assert.equal(begin.status, 303);
          assert.equal(begin.headers.get("referrer-policy"), "no-referrer");
          const authorize = new URL(begin.headers.get("location")!);
          assert.equal(authorize.searchParams.get("client_id"), clientId);
          nonce = authorize.searchParams.get("nonce")!;
          return {
            state: authorize.searchParams.get("state")!,
            cookie: begin.headers.get("set-cookie")!.split(";")[0],
          };
        };
        const failure = async (
          response: Response,
          reason: string,
          page = `${prefix}slack`,
        ) => {
          assert.equal(response.status, 303);
          assert.equal(
            response.headers.get("location"),
            `http://127.0.0.1:5173/#/${page}/${reason}`,
          );
          assert.match(response.headers.get("set-cookie")!, /Max-Age=0/);
        };
        // Forged callbacks: no cookie (variant unknown), or a state from another browser.
        const other = await login();
        await failure(
          await navigate(
            `/auth/slack/callback?code=synthetic-code&state=${other.state}`,
          ),
          "expired",
          "slack",
        );
        await failure(
          await navigate(
            `/auth/slack/callback?code=synthetic-code&state=${randomHex()}`,
            other.cookie,
          ),
          "expired",
        );
        // Guests cannot start a Slack session.
        loginUser = { is_restricted: true };
        const guest = await login();
        await failure(
          await navigate(
            `/auth/slack/callback?code=synthetic-code&state=${guest.state}`,
            guest.cookie,
          ),
          "forbidden",
        );
        loginUser = {};
        const member = await login();
        const createdResponse = await navigate(
          `/auth/slack/callback?code=synthetic-code&state=${member.state}`,
          member.cookie,
        );
        assert.equal(createdResponse.status, 303);
        assert.equal(
          createdResponse.headers.get("referrer-policy"),
          "no-referrer",
        );
        assert.match(createdResponse.headers.get("set-cookie")!, /Max-Age=0/);
        const landing =
          /^http:\/\/127\.0\.0\.1:5173\/#\/host\/([a-f0-9]{32}\.[a-f0-9]{64})\/([a-z]+(?:-[a-z]+){4})$/.exec(
            createdResponse.headers.get("location")!,
          );
        assert.ok(landing);
        const created = {
          hostCapability: landing[1],
          spectatorCapability: landing[2],
        };
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
          revokeGrant(): Promise<void>;
          shortExpiry(): Promise<void>;
          ceiling(ms: number): Promise<void>;
          legacyGrant(hash: string): Promise<void>;
          loginGrant(): Promise<void>;
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
        assert.equal(state.variant, variant);
        assert.equal((await snapshot(viewer)).variant, variant);
        assert.equal(
          (
            await command({
              type: "setVariant",
              variant: variant === "beer" ? "coffee" : "beer",
            })
          ).status,
          400,
        );
        const stableId = state.participants[0].id;
        const hostText = JSON.stringify(state),
          viewerState = await snapshot(viewer);
        for (const secret of [
          "C00000001",
          "U00000001",
          "1234567890.123456",
          credential,
          clientSecret,
          "U00000007",
          "synthetic-user-credential",
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
        // Submitting the same permalink again must replace, not append.
        await stub.unlockImport();
        assert.equal(
          (
            await command({
              type: "slackImport",
              permalink:
                "https://synthetic.slack.com/archives/C00000001/p1234567890123456",
            })
          ).status,
          200,
        );
        state = await snapshot(host);
        assert.deepEqual(
          state.participants.map((p) => p.name),
          ["Bob", "Alice", "Alice (2)"],
        );
        assert.equal(
          state.participants.find((p) => p.name === "Alice")!.id,
          stableId,
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
        // Unexpired login sessions can extend past their 24-hour expiry up to their fixed ceiling.
        await stub.shortExpiry();
        await stub.ceiling(3 * 24 * 3600000);
        const later = Date.now() + 2 * 24 * 3600000;
        assert.equal(
          (
            await command({
              type: "setScheduledDraw",
              startAt: new Date(later).toISOString(),
            })
          ).status,
          200,
        );
        state = await snapshot(host);
        assert.equal(Date.parse(state.expiresAt), later + 3600000);
        assert.equal(
          Date.parse((await snapshot(viewer)).expiresAt),
          later + 3600000,
        );
        assert.equal(
          (
            await command({
              type: "setScheduledDraw",
              startAt: new Date(Date.now() + 4 * 24 * 3600000).toISOString(),
            })
          ).status,
          400,
        );
        assert.equal(
          Date.parse((await snapshot(host)).expiresAt),
          later + 3600000,
        );
        // Sessions started with a legacy start link no longer have Slack rights.
        await stub.legacyGrant(legacyHash);
        assert.equal(
          (
            await command({
              type: "setScheduledDraw",
              startAt: new Date(Date.now() + 2.5 * 24 * 3600000).toISOString(),
            })
          ).status,
          403,
        );
        await stub.loginGrant();
        assert.equal(
          (await command({ type: "setScheduledDraw", startAt: null })).status,
          200,
        );
        const readsBeforeStart = readCalls;
        const start = await command({
          type: "setScheduledDraw",
          startAt: new Date(Date.now() + 5000).toISOString(),
        });
        assert.equal(start.status, 200);
        // Change reactors after the last import. Only the final server check can see this.
        users = ["U00000003"];
        assert.equal(posts, 0);
        // No browser, socket, polling, or completion callback: only durable alarm runs.
        await new Promise((resolve) => setTimeout(resolve, 15000));
        assert.equal(readCalls, readsBeforeStart + 1);
        state = await snapshot(host);
        assert.equal(state.scheduledDraw, undefined);
        const official = state.activeDraw!.spins.map(
          (sp) => state.participants.find((p) => p.id === sp.winnerId)!.name,
        );
        assert.equal(posts, 1);
        state = await snapshot(host);
        assert.equal(state.state, "finished");
        assert.equal(state.slack?.result?.status, "posted");
        assert.ok(
          String(sent[0].text).includes(
            { beer: "bier halen", coffee: "koffie halen", water: "water halen" }[
              variant
            ],
          ),
        );
        assert.ok(
          String(sent[0].text).startsWith(
            { beer: "🍻", coffee: "☕", water: "💧" }[variant],
          ),
        );
        assert.equal(sent[0].thread_ts, "1234567890.123456");
        assert.equal(sent[0].reply_broadcast, false);
        assert.ok(String(sent[0].text).includes(official.join(" · ")));
        const resultBlocks = sent[0].blocks as {
          elements: {
            elements: { type: string; user_id?: string; text?: string }[];
          }[];
        }[];
        const mentionElements = resultBlocks[0].elements[0].elements;
        assert.deepEqual(
          mentionElements
            .filter((e) => e.type === "user")
            .map((e) => e.user_id),
          ["U00000003"],
        );
        assert.ok(
          mentionElements.some((e) => e.type === "text" && e.text === "Bob"),
        );
        assert.ok(!JSON.stringify(state).includes("U00000001"));
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
        await new Promise((resolve) => setTimeout(resolve, 12500));
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
        // A failed final read leaves the old roster visible but must not draw or post.
        assert.equal((await command({ type: "reset" })).status, 200);
        await stub.unlockImport();
        mode = "read-reject";
        assert.equal(
          (
            await command({
              type: "setScheduledDraw",
              startAt: new Date(Date.now() + 5000).toISOString(),
            })
          ).status,
          200,
        );
        await new Promise((resolve) => setTimeout(resolve, 4000));
        state = await snapshot(host);
        assert.equal(state.scheduledDraw?.status, "skipped");
        assert.equal(state.activeDraw, undefined);
        assert.equal(posts, 3);
        await stub.runCompletion();
        assert.equal(posts, 3);
        const readsBeforeRevocation = readCalls;
        assert.equal(
          (
            await command({
              type: "setScheduledDraw",
              startAt: new Date(Date.now() + 5000).toISOString(),
            })
          ).status,
          200,
        );
        await stub.revokeGrant();
        await new Promise((resolve) => setTimeout(resolve, 4000));
        state = await snapshot(host);
        assert.equal(state.scheduledDraw?.status, "skipped");
        assert.equal(state.activeDraw, undefined);
        assert.equal(readCalls, readsBeforeRevocation);
        assert.equal(posts, 3);
        await stub.forceExpire();
        assert.equal((await call("/api/session", host)).status, 404);
        assert.equal(await stub.storedRows(), 0);
      } finally {
        await mf.dispose();
      }
    },
  );
