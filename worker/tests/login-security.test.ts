import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { wordLocator } from "../auth";
import type { ChannelCommandResult, ChannelStatus } from "../../shared/channel";
import type { PublicBeerWheelSession } from "../../shared/protocol";

const origin = "http://127.0.0.1:5173";

test(
  "Worker login attempts reject tampering, replay, expiry and revoked channel access",
  { timeout: 60000 },
  async (t) => {
    const script = await readFile("worker-dist/index.js", "utf8");
    const clientId = "1000000000.2000000000";
    let nonce = "";
    let tokenGate: (() => Promise<void>) | undefined;
    let sub = "U00000007";
    let ts = 1234567890100000;
    const posts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const reactors = ["UBOT00001", "U00000001", "U00000002", "U00000003"];
    const names: Record<string, string> = {
      U00000001: "Alice",
      U00000002: "Bob",
      U00000003: "Carol",
      U00000007: "Dana",
    };
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "reviews-test",
            modules: true,
            script:
              script +
              `\nexport class TestSession extends LiveSession {
      edit(fn) { const r = JSON.parse(this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value); fn(r); this.ctx.storage.sql.exec('UPDATE session SET value = ? WHERE singleton = 1', JSON.stringify(r)); }
      stored() { return this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value; }
      pastReview() { this.edit(r => { r.review.opensAt -= 30*60000; r.review.closesAt -= 30*60000; }); }
      async due() { this.edit(r => { r.scheduledDraw.startAt = new Date(Date.now() + 4000).toISOString(); }); return this.alarm(); }
      land() { this.edit(r => { const d = r.session.activeDraw; const end = Math.max(...d.spins.map(s => Date.parse(s.startAt) + s.durationMs)); const shift = end - Date.now() + 1000; const move = t => new Date(Date.parse(t) - shift).toISOString(); d.startAt = move(d.startAt); for (const s of d.spins) s.startAt = move(s.startAt); if (r.review) { r.review.opensAt -= shift + 60000; r.review.closesAt -= shift + 60000; } if (r.slack.job) r.slack.job.readyAt -= shift; if (r.slack.card) r.slack.card.readyAt -= shift; }); return this.alarm(); }
      async run() { return this.alarm(); }
    }
    export class TestChannel extends ChannelWheel {
      async expireAttempt() { const r = await this.ctx.storage.get("login"); r.pending.expiresAt = Date.now() - 1; await this.ctx.storage.put("login", r); }
      async hasAttempt() { return !!(await this.ctx.storage.get("login")); }
      async runAlarm() { return this.alarm(); }
      async pastWatch() { const b=JSON.parse(this.stored()); b.round.startAt=Date.now()-30*60000; b.round.endsAt=Date.now()-1; this.ctx.storage.sql.exec("UPDATE binding SET value = ? WHERE singleton = 1",JSON.stringify(b)); }
      stored() { return this.ctx.storage.sql.exec('SELECT value FROM binding WHERE singleton = 1').toArray()[0]?.value ?? null; }
    }`,
            compatibilityDate: "2026-09-25",
            compatibilityFlags: ["nodejs_compat"],
            durableObjects: {
              SESSIONS: { className: "TestSession", useSQLite: true },
              CHANNELS: { className: "TestChannel", useSQLite: true },
            },
            bindings: {
              ALLOWED_ORIGINS: origin,
              FRONTEND_URL: `${origin}/`,
              COFFEE_SLACK_BOT_TOKEN: "synthetic-coffee-credential",
              COFFEE_SLACK_CLIENT_ID: clientId,
              COFFEE_SLACK_CLIENT_SECRET: "synthetic-coffee-client-secret",
              COFFEE_SLACK_SIGNING_SECRET: "synthetic-signing-secret",
            },
            ratelimits: {
              CREATION_LIMIT: {
                namespace_id: "40",
                simple: { limit: 100, period: 60 },
              },
              CREATION_GLOBAL: {
                namespace_id: "41",
                simple: { limit: 100, period: 60 },
              },
              REQUEST_LIMIT: {
                namespace_id: "42",
                simple: { limit: 500, period: 60 },
              },
            },
            outboundService: async (req: Request) => {
              const url = new URL(req.url);
              const path = url.pathname.replace("/api/", "");
              if (path === "openid.connect.token") {
                await tokenGate?.();
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
                    sub,
                    "https://slack.com/team_id": "T00000001",
                  })}.c2ln`,
                });
              }
              if (path === "auth.revoke") return Response.json({ ok: true });
              if (path === "auth.test")
                return Response.json({
                  ok: true,
                  team_id: "T00000001",
                  user_id: "UBOT00001",
                });
              if (path === "users.info") {
                const id = url.searchParams.get("user")!;
                return Response.json({
                  ok: true,
                  user: {
                    id,
                    team_id: "T00000001",
                    deleted: false,
                    is_bot: false,
                    profile: { display_name: names[id] ?? "Erin" },
                  },
                });
              }
              if (path === "reactions.add") return Response.json({ ok: true });
              if (path === "reactions.get")
                return Response.json({
                  ok: true,
                  type: "message",
                  channel: "C00000001",
                  message: {
                    ts: url.searchParams.get("timestamp"),
                    reactions: [
                      {
                        name: "coffee",
                        count: reactors.length,
                        users: reactors,
                      },
                    ],
                  },
                });
              const body = (await req.json()) as Record<string, unknown>;
              if (path === "chat.update") {
                updates.push(body);
                return Response.json({
                  ok: true,
                  channel: body.channel,
                  ts: body.ts,
                });
              }
              assert.equal(path, "chat.postMessage");
              posts.push(body);
              ts++;
              return Response.json({
                ok: true,
                channel: body.channel,
                ts: `${String(ts).slice(0, 10)}.${String(ts).slice(10)}`,
              });
            },
          },
        ],
      }),
    );
    const api = (cap: string, body?: object) =>
      mf.dispatchFetch("http://localhost/api/channel", {
        method: body ? "POST" : "GET",
        headers: {
          Origin: origin,
          Authorization: `Bearer ${cap}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const status = async (cap: string, body?: object) => {
      const response = await api(cap, body);
      assert.equal(response.status, 200, await response.clone().text());
      return ((await response.json()) as { status: ChannelStatus }).status;
    };
    /** A signed `/koffierad` in the bound channel: the only way to start a round. */
    const koffierad = async () => {
      const body = new URLSearchParams({
        command: "/koffierad",
        user_id: "U00000001",
        channel_id: "C00000001",
        team_id: "T00000001",
        text: "",
      }).toString();
      const at = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", "synthetic-signing-secret")
        .update(`v0:${at}:${body}`)
        .digest("hex");
      const response = await mf.dispatchFetch(
        "http://localhost/slack/commands",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Slack-Request-Timestamp": String(at),
            "X-Slack-Signature": `v0=${signature}`,
          },
          body,
        },
      );
      assert.equal(await response.text(), "");
    };
    const navigate = (path: string, cookie?: string, init?: RequestInit) =>
      mf.dispatchFetch(`http://localhost${path}`, {
        redirect: "manual",
        ...init,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(init?.headers as Record<string, string>),
        },
      });
    const callback = (authorizeAt: string, cookie: string) => {
      const authorize = new URL(authorizeAt);
      nonce = authorize.searchParams.get("nonce")!;
      return navigate(
        `/auth/slack/callback?code=synthetic-code&state=${authorize.searchParams.get("state")}`,
        cookie,
      );
    };
    const memberStart = (body: string, headers: Record<string, string> = {}) =>
      navigate("/auth/slack/member", undefined, {
        method: "POST",
        headers: {
          Origin: origin,
          "Content-Type": "application/x-www-form-urlencoded",
          ...headers,
        },
        body,
      });
    /** The whole personal login: form POST, Slack, callback; returns the personal link. */
    const login = async (requester: string, user: string) => {
      const begin = await memberStart(
        new URLSearchParams({ capability: requester }).toString(),
      );
      assert.equal(begin.status, 303);
      const cookie = begin.headers.get("set-cookie")!.split(";")[0];
      assert.match(cookie, /=[a-f0-9]{32}\.[a-f0-9]{64}$/);
      sub = user;
      const done = await callback(begin.headers.get("location")!, cookie);
      const personal = /#\/koffie\/([a-f0-9]{32}\.[a-f0-9]{64})$/.exec(
        done.headers.get("location")!,
      );
      assert.ok(personal, done.headers.get("location")!);
      return personal[1];
    };
    try {
      // Bind (Dana), then the admin turns reviews on with a five-minute window.
      const begin = await navigate("/auth/slack/channel/C00000001");
      const bound = await callback(
        begin.headers.get("location")!,
        begin.headers.get("set-cookie")!.split(";")[0],
      );
      const [, admin, requester] =
        /#\/koffie-beheer\/([a-f0-9.]+)\/([a-f0-9.]+)$/.exec(
          bound.headers.get("location")!,
        )!;

      const refused = (response: Response) =>
        assert.match(response.headers.get("location")!, /\/expired$/);
      const start = (cap: string) =>
        memberStart(new URLSearchParams({ capability: cap }).toString());
      const finish = (
        begin: Response,
        cookie = begin.headers.get("set-cookie")!.split(";")[0],
      ) => callback(begin.headers.get("location")!, cookie);
      const namespace = await mf.getDurableObjectNamespace("CHANNELS");
      await t.test(
        "purpose never comes from the cookie and a swapped handle cannot change it",
        async () => {
          const first = await start(requester);
          const second = await navigate("/auth/slack/channel/C00000002");
          refused(
            await finish(
              first,
              second.headers.get("set-cookie")!.split(";")[0],
            ),
          );
          const legacy =
            "__Host-bierrad-slack-login=member-" +
            requester.split(".")[0] +
            "." +
            "a".repeat(64) +
            "." +
            "b".repeat(64) +
            "." +
            (Date.now() + 60000);
          refused(await finish(first, legacy));
          const done = await finish(first);
          assert.match(done.headers.get("location")!, /#\/koffie\/[a-f0-9.]+$/);
          refused(await finish(first));
        },
      );
      await t.test(
        "expiry is server-side and abandoned attempts are erased by the alarm",
        async () => {
          const begin = await start(requester);
          const handle = begin.headers
            .get("set-cookie")!
            .split("=")[1]
            .split(";")[0];
          const attempt = namespace.get(
            namespace.idFromName("login:" + handle.split(".")[0]),
          ) as unknown as {
            expireAttempt(): Promise<void>;
            hasAttempt(): Promise<boolean>;
            runAlarm(): Promise<void>;
          };
          assert.equal(await attempt.hasAttempt(), true);
          await attempt.expireAttempt();
          refused(await finish(begin));
          assert.equal(await attempt.hasAttempt(), false);
          const abandoned = await start(requester);
          const other = abandoned.headers
            .get("set-cookie")!
            .split("=")[1]
            .split(".")[0];
          const orphan = namespace.get(
            namespace.idFromName("login:" + other),
          ) as unknown as typeof attempt;
          await orphan.expireAttempt();
          await orphan.runAlarm();
          assert.equal(await orphan.hasAttempt(), false);
        },
      );
      await t.test(
        "logout revokes a pending login begun from the personal link",
        async () => {
          const personal = await login(requester, "U00000001");
          const begin = await start(personal);
          await api(personal, { type: "logout" });
          refused(await finish(begin));
        },
      );

      await t.test(
        "review outcomes remain watchable after the original half-hour, even without polling",
        async () => {
          await api(admin, { type: "setReviews", enabled: true, minutes: 30 });
          await koffierad();
          const round = (await status(requester)).round!;
          const sessions = await mf.getDurableObjectNamespace("SESSIONS");
          const session = sessions.get(
            sessions.idFromName(await wordLocator(round.spectatorCapability)),
          ) as unknown as {
            due(): Promise<void>;
            pastReview(): Promise<void>;
            stored(): Promise<string>;
          };
          await session.due();
          await session.pastReview();
          const record = JSON.parse(await session.stored());
          const channel = namespace.get(
            namespace.idFromName(admin.split(".")[0]),
          ) as unknown as {
            pastWatch(): Promise<void>;
            runAlarm(): Promise<void>;
            stored(): Promise<string>;
          };
          await channel.pastWatch();
          await channel.runAlarm();
          const kept = JSON.parse(await channel.stored());
          assert.ok(kept.round);
          assert.ok(kept.round.endsAt >= record.review.closesAt);
          assert.ok(kept.round.endsAt <= kept.round.startAt + 60 * 60000);
          assert.ok((await status(requester)).round);
        },
      );
      await t.test("rotation revokes an in-flight personal login", async () => {
        const begin = await start(requester);
        let entered!: () => void, release!: () => void;
        const entry = new Promise<void>((r) => {
          entered = r;
        });
        const gate = new Promise<void>((r) => {
          release = r;
        });
        tokenGate = async () => {
          entered();
          await gate;
        };
        const finishing = finish(begin);
        try {
          await entry;
          await api(admin, { type: "rotateRequestLink" });
          assert.equal((await api(requester)).status, 404);
        } finally {
          release();
          tokenGate = undefined;
        }
        refused(await finishing);
      });
      await t.test(
        "rebinding invalidates a pending personal login",
        async () => {
          const begin = await navigate("/auth/slack/channel/C00000003");
          const boundAgain = await finish(begin);
          const match = /-beheer\/([a-f0-9.]+)\/([a-f0-9.]+)$/.exec(
            boundAgain.headers.get("location")!,
          )!;
          const personalStart = await start(match[2]);
          await finish(await navigate("/auth/slack/channel/C00000003"));
          refused(await finish(personalStart));
        },
      );
      await t.test(
        "successful callbacks can only consume an attempt once, even concurrently",
        async () => {
          const begin = await navigate("/auth/slack/channel/C00000002");
          const replies = await Promise.all([finish(begin), finish(begin)]);
          assert.equal(
            replies.filter((r) => /-beheer\//.test(r.headers.get("location")!))
              .length,
            1,
          );
          assert.equal(
            replies.filter((r) => /\/expired$/.test(r.headers.get("location")!))
              .length,
            1,
          );
        },
      );
    } finally {
      await mf.dispose();
    }
  },
);
