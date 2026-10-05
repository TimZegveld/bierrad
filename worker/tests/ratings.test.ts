import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { newSession, mutate, publicSession } from "../session";
import { hashSecret, randomHex } from "../auth";
import { ratingLocator } from "../rating-utils";
import { parseLoginCookie } from "../slack/login";

test("rating settings are opt-in, validated, Slack-only and freeze the electorate at draw time", () => {
  const now = Date.now();
  const r = newSession("host", "viewer", now);
  const command = (c: object) =>
    mutate(r, "host", { ...c, revision: r.revision }, now);
  assert.equal(publicSession(r).ratings, undefined);
  assert.throws(() =>
    command({
      type: "setRatings",
      settings: { enabled: true, delayMinutes: 3 },
    }),
  );
  r.slack = {
    teamId: "T00000001",
    grantHash: "slack-login",
    mapping: { U00000001: "p1", U00000002: "p2" },
    source: {
      channelId: "C00000001",
      parentMessageTs: "1700000000.000001",
      reactionName: "beers",
    },
  };
  r.session = {
    ...r.session,
    participants: [
      { id: "p1", name: "Testpersoon A" },
      { id: "p2", name: "Testpersoon B" },
    ],
    state: "ready",
    winnerCount: 2,
  };
  for (const delayMinutes of [0, 31, 1.5, "3"])
    assert.throws(() =>
      command({
        type: "setRatings",
        settings: { enabled: true, delayMinutes },
      }),
    );
  assert.throws(() =>
    mutate(
      r,
      "spectator",
      {
        type: "setRatings",
        revision: r.revision,
        settings: { enabled: true, delayMinutes: 3 },
      },
      now,
    ),
  );
  command({ type: "setRatings", settings: { enabled: true, delayMinutes: 3 } });
  command({ type: "startDraw" });
  const round = r.ratingRounds![0];
  const draw = r.session.activeDraw!;
  assert.equal(
    Date.parse(round.opensAt),
    Date.parse(draw.startAt) +
      Math.max(...draw.spins.map((s) => s.durationMs)) +
      180000,
  );
  assert.deepEqual(round.electorate, ["U00000001", "U00000002"]);
  r.slack.mapping = {};
  assert.equal(round.identities.p1, "U00000001");
  const serialized = JSON.stringify(publicSession(r));
  assert.ok(!serialized.includes("U00000001"));
  assert.ok(!serialized.includes("electorate"));
  assert.ok(!serialized.includes("identities"));
  assert.ok(!serialized.includes("teamId"));
});

test(
  "real SQLite ratings: concurrent votes, durable deduplication, workspace/variant isolation, OAuth, archived rounds and expiry",
  { timeout: 60000 },
  async () => {
    const source = await readFile("worker-dist/index.js", "utf8");
    const origin = "http://127.0.0.1:5173";
    const team = "T00000001";
    const clientId = "1000000000.2000000000";
    let loginUser = "U00000001",
      nonce = "",
      revoked = 0;
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "ratings-test",
            modules: true,
            script:
              source +
              `\nexport class TestSession extends LiveSession {
      prepare(open) {
        const r = JSON.parse(this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value);
        r.ratingSettings = { enabled: true, delayMinutes: 3 };
        r.ratingRounds = [{ drawId: '00000000-0000-4000-8000-000000000001', opensAt: new Date(Date.now() + (open ? -1000 : 180000)).toISOString(), winners: [{id:'p1',name:'Testpersoon A'},{id:'p2',name:'Testpersoon B'}], identities:{p1:'U00000001',p2:'U00000002'}, electorate:['U00000001','U00000002'] }];
        r.session.participants = [{id:'p1',name:'Testpersoon A'},{id:'p2',name:'Testpersoon B'}]; r.slack.mapping = {U00000001:'p1',U00000002:'p2'};
        this.ctx.storage.sql.exec('UPDATE session SET value = ? WHERE singleton = 1', JSON.stringify(r));
      }
      async expireNow() { const r = JSON.parse(this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value); r.expiresAt = Date.now()-1; this.ctx.storage.sql.exec('UPDATE session SET value = ? WHERE singleton = 1', JSON.stringify(r)); await this.alarm(); }
      stored() { return this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value; }
      removeParticipants() { const r = JSON.parse(this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value); r.session.participants = []; r.slack.mapping = {}; this.ctx.storage.sql.exec('UPDATE session SET value = ? WHERE singleton = 1', JSON.stringify(r)); }
    }
    export class TestRatings extends Ratings { cleanup() { this.ctx.storage.sql.exec('UPDATE ballots SET expires = 0'); return this.alarm(); } deadline(id) { return this.ctx.storage.sql.exec('SELECT expires FROM ballots WHERE id = ?', id).one().expires; } }
    `,
            compatibilityDate: "2026-09-25",
            compatibilityFlags: ["nodejs_compat"],
            durableObjects: {
              SESSIONS: { className: "TestSession", useSQLite: true },
              RATINGS: { className: "TestRatings", useSQLite: true },
            },
            bindings: {
              ALLOWED_ORIGINS: origin,
              FRONTEND_URL: `${origin}/`,
              SLACK_BOT_TOKEN: "synthetic-bot-credential",
              SLACK_CLIENT_ID: clientId,
              SLACK_CLIENT_SECRET: "synthetic-client-secret",
            },
            ratelimits: {
              CREATION_LIMIT: {
                namespace_id: "81",
                simple: { limit: 1000, period: 60 },
              },
              CREATION_GLOBAL: {
                namespace_id: "82",
                simple: { limit: 1000, period: 60 },
              },
              REQUEST_LIMIT: {
                namespace_id: "83",
                simple: { limit: 1000, period: 60 },
              },
            },
            outboundService: async (req: Request) => {
              const url = new URL(req.url);
              assert.equal(url.origin, "https://slack.com");
              if (url.pathname === "/api/openid.connect.token") {
                const encode = (o: object) =>
                  btoa(JSON.stringify(o)).replace(/=+$/, "");
                return Response.json({
                  ok: true,
                  access_token: "synthetic-user-credential",
                  id_token: `${encode({})}.${encode({ iss: "https://slack.com", aud: clientId, exp: Math.floor(Date.now() / 1000) + 300, nonce, sub: loginUser, "https://slack.com/team_id": team })}.c2ln`,
                });
              }
              if (url.pathname === "/api/auth.revoke") {
                revoked++;
                return Response.json({ ok: true });
              }
              if (url.pathname === "/api/auth.test")
                return Response.json({ ok: true, team_id: team });
              if (url.pathname === "/api/users.info")
                return Response.json({
                  ok: true,
                  user: {
                    id: loginUser,
                    team_id: team,
                    deleted: false,
                    is_bot: false,
                  },
                });
              throw new Error("Unexpected synthetic Slack request");
            },
          },
        ],
      }),
    );
    try {
      const ns = await mf.getDurableObjectNamespace("RATINGS");
      const store = ns.get(
        ns.idFromName(await ratingLocator(team, "beer")),
      ) as any;
      const expiry = Date.now() + 3600000;
      const ballots = await Promise.all(
        Array.from({ length: 120 }, (_, i) =>
          hashSecret(`synthetic-ballot-${i}`),
        ),
      );
      const submissions = await Promise.all(
        ballots.flatMap((id, i) =>
          [1, 2, 3].map(() =>
            store.vote(
              id,
              [{ person: "U00000001", stars: (i % 5) + 1 }],
              expiry,
            ),
          ),
        ),
      );
      assert.equal(submissions.filter(Boolean).length, 120);
      const extendableBallot = await hashSecret("extendable-synthetic-ballot");
      await store.vote(
        extendableBallot,
        [{ person: "U00000003", stars: 5 }],
        Date.now() + 1000,
        expiry,
      );
      assert.equal(await store.deadline(extendableBallot), expiry);
      assert.equal(
        await store.vote(
          extendableBallot,
          [{ person: "U00000003", stars: 1 }],
          expiry,
          expiry,
        ),
        false,
      );
      assert.deepEqual((await store.summaries(["U00000001"]))["U00000001"], {
        average: 3,
        count: 120,
      });
      const again = ns.get(
        ns.idFromName(await ratingLocator(team, "beer")),
      ) as any;
      assert.equal(
        await again.vote(
          ballots[0],
          [{ person: "U00000001", stars: 5 }],
          expiry,
        ),
        false,
      );
      for (const scope of [
        [team, "coffee"],
        [team, "water"],
        ["T00000002", "beer"],
      ] as const) {
        const isolated = ns.get(
          ns.idFromName(await ratingLocator(...scope)),
        ) as any;
        assert.deepEqual(
          (await isolated.summaries(["U00000001"]))["U00000001"],
          { average: 0, count: 0 },
        );
      }
      await assert.rejects(
        store.vote(
          await hashSecret("bad-score"),
          [{ person: "U00000001", stars: 6 }],
          expiry,
        ),
      );
      await assert.rejects(
        store.vote(
          await hashSecret("expired-score"),
          [{ person: "U00000001", stars: 5 }],
          Date.now() - 1,
        ),
      );
      const sessions = await mf.getDurableObjectNamespace("SESSIONS");
      const locator = "a".repeat(32),
        host = randomHex(),
        spectator = randomHex();
      const session = sessions.get(sessions.idFromName(locator)) as any;
      await session.initialize(
        await hashSecret(host),
        await hashSecret(spectator),
        { hash: "slack-login", expiresAt: expiry, teamId: team },
        "beer",
      );
      await session.prepare(false);
      const drawId = "00000000-0000-4000-8000-000000000001";
      await assert.rejects(session.ratingLogin(spectator, drawId));
      await session.prepare(true);
      await assert.rejects(session.ratingGrant(drawId, team, "U00000009"));
      await assert.rejects(
        session.ratingGrant(drawId, "T00000002", "U00000001"),
      );
      const call = (path: string, secret?: string, body?: unknown) =>
        mf.dispatchFetch(`http://localhost${path}`, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Origin: origin,
            ...(secret ? { Authorization: `Bearer ${locator}.${secret}` } : {}),
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      assert.equal((await call("/api/rating", spectator)).status, 404);
      assert.equal((await call("/api/rating", host)).status, 404);
      const begin = () =>
        mf.dispatchFetch("http://localhost/auth/slack/rating", {
          method: "POST",
          redirect: "manual",
          headers: {
            Origin: origin,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            capability: `${locator}.${spectator}`,
            drawId,
          }).toString(),
        });
      const login = await begin();
      assert.equal(login.status, 303);
      const cookie = login.headers.get("Set-Cookie")!;
      const pending = parseLoginCookie(cookie)!;
      assert.deepEqual(pending.rating, { locator, drawId });
      nonce = pending.nonce;
      const complete = (state = pending.state) =>
        mf.dispatchFetch(
          `http://localhost/auth/slack/callback?state=${state}&code=synthetic-code`,
          { redirect: "manual", headers: { Cookie: cookie.split(";")[0] } },
        );
      assert.ok(
        (await complete(randomHex())).headers
          .get("Location")!
          .includes("/expired"),
      );
      const callback = await complete();
      const cap = callback.headers.get("Location")!.split("#/rate/")[1];
      assert.match(cap, /^[a-f0-9]{32}\.[a-f0-9]{64}$/);
      const token = cap.split(".")[1];
      assert.equal(revoked, 1);
      const ballot = (await (await call("/api/rating", token)).json()) as any;
      assert.equal(ballot.submitted, false);
      assert.ok(!JSON.stringify(ballot).includes("U00000001"));
      // Removing/resetting the current roster does not discard the frozen eligible draw.
      await session.removeParticipants();
      for (const scores of [
        [{ winnerId: "p1", stars: 5 }],
        [
          { winnerId: "p1", stars: 5 },
          { winnerId: "p1", stars: 4 },
        ],
        [
          { winnerId: "p1", stars: 0 },
          { winnerId: "p2", stars: 5 },
        ],
        [
          { winnerId: "fake", stars: 5 },
          { winnerId: "p2", stars: 5 },
        ],
      ])
        assert.equal(
          (await call("/api/rating", token, { scores })).status,
          400,
        );
      const scores = [
        { winnerId: "p1", stars: 5 },
        { winnerId: "p2", stars: 4 },
      ];
      const responses = await Promise.all(
        Array.from({ length: 20 }, () =>
          call("/api/rating", token, { scores }),
        ),
      );
      assert.ok(responses.every((r) => r.status === 200));
      assert.equal(
        (await store.summaries(["U00000001"]))["U00000001"].count,
        121,
      );
      assert.deepEqual((await store.summaries(["U00000002"]))["U00000002"], {
        average: 4,
        count: 1,
      });
      const newGrant = await session.ratingGrant(drawId, team, "U00000001");
      assert.equal((await call("/api/rating", token)).status, 404);
      assert.equal(
        ((await (await call("/api/rating", newGrant)).json()) as any).submitted,
        true,
      );
      loginUser = "U00000009";
      assert.ok(
        (await complete()).headers.get("Location")!.includes("/forbidden"),
      );
      await session.expireNow();
      assert.equal((await call("/api/rating", newGrant)).status, 404);
      assert.equal(
        (await store.summaries(["U00000001"]))["U00000001"].count,
        121,
      );
      await store.cleanup();
      assert.equal(await store.hasBallot(ballots[0]), false);
      assert.equal(
        (await store.summaries(["U00000001"]))["U00000001"].count,
        121,
      );
    } finally {
      await mf.dispose();
    }
  },
);
