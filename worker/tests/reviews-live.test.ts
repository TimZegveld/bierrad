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
  "Worker: personal links from Sign in with Slack review a channel round once, anonymously, and forget",
  { timeout: 60000 },
  async () => {
    const script = await readFile("worker-dist/index.js", "utf8");
    const clientId = "1000000000.2000000000";
    let nonce = "";
    let sub = "U00000007";
    let ts = 1234567890100000;
    const posts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const reactors = ["UBOT00001", "U00000001", "U00000002", "U00000003"];
    const names: Record<string, string> = { U00000001: "Alice", U00000002: "Bob", U00000003: "Carol", U00000007: "Dana" };
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
      async due() { this.edit(r => { r.scheduledDraw.startAt = new Date(Date.now() + 4000).toISOString(); }); return this.alarm(); }
      land() { this.edit(r => { const d = r.session.activeDraw; const end = Math.max(...d.spins.map(s => Date.parse(s.startAt) + s.durationMs)); const shift = end - Date.now() + 1000; const move = t => new Date(Date.parse(t) - shift).toISOString(); d.startAt = move(d.startAt); for (const s of d.spins) s.startAt = move(s.startAt); if (r.review) { r.review.opensAt -= shift + 60000; r.review.closesAt -= shift + 60000; } if (r.slack.job) r.slack.job.readyAt -= shift; if (r.slack.card) r.slack.card.readyAt -= shift; }); return this.alarm(); }
      async run() { return this.alarm(); }
    }
    export class TestChannel extends ChannelWheel {
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
              CREATION_LIMIT: { namespace_id: "40", simple: { limit: 100, period: 60 } },
              CREATION_GLOBAL: { namespace_id: "41", simple: { limit: 100, period: 60 } },
              REQUEST_LIMIT: { namespace_id: "42", simple: { limit: 500, period: 60 } },
            },
            outboundService: async (req: Request) => {
              const url = new URL(req.url);
              const path = url.pathname.replace("/api/", "");
              if (path === "openid.connect.token") {
                const part = (v: object) => btoa(JSON.stringify(v)).replace(/=+$/, "");
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
                return Response.json({ ok: true, team_id: "T00000001", user_id: "UBOT00001" });
              if (path === "users.info") {
                const id = url.searchParams.get("user")!;
                return Response.json({
                  ok: true,
                  user: { id, team_id: "T00000001", deleted: false, is_bot: false, profile: { display_name: names[id] ?? "Erin" } },
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
                    reactions: [{ name: "coffee", count: reactors.length, users: reactors }],
                  },
                });
              const body = (await req.json()) as Record<string, unknown>;
              if (path === "chat.update") {
                updates.push(body);
                return Response.json({ ok: true, channel: body.channel, ts: body.ts });
              }
              assert.equal(path, "chat.postMessage");
              posts.push(body);
              ts++;
              return Response.json({ ok: true, channel: body.channel, ts: `${String(ts).slice(0, 10)}.${String(ts).slice(10)}` });
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
      const body = new URLSearchParams({ command: "/koffierad", user_id: "U00000001", channel_id: "C00000001", team_id: "T00000001", text: "" }).toString();
      const at = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", "synthetic-signing-secret").update(`v0:${at}:${body}`).digest("hex");
      const response = await mf.dispatchFetch("http://localhost/slack/commands", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Slack-Request-Timestamp": String(at), "X-Slack-Signature": `v0=${signature}` },
        body,
      });
      assert.equal(await response.text(), "");
    };
    const navigate = (path: string, cookie?: string, init?: RequestInit) =>
      mf.dispatchFetch(`http://localhost${path}`, {
        redirect: "manual",
        ...init,
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(init?.headers as Record<string, string>) },
      });
    const callback = (authorizeAt: string, cookie: string) => {
      const authorize = new URL(authorizeAt);
      nonce = authorize.searchParams.get("nonce")!;
      return navigate(`/auth/slack/callback?code=synthetic-code&state=${authorize.searchParams.get("state")}`, cookie);
    };
    const memberStart = (body: string, headers: Record<string, string> = {}) =>
      navigate("/auth/slack/member", undefined, {
        method: "POST",
        headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded", ...headers },
        body,
      });
    /** The whole personal login: form POST, Slack, callback; returns the personal link. */
    const login = async (requester: string, user: string) => {
      const begin = await memberStart(new URLSearchParams({ capability: requester }).toString());
      assert.equal(begin.status, 303);
      const cookie = begin.headers.get("set-cookie")!.split(";")[0];
      assert.match(cookie, /member-[a-f0-9]{32}\./);
      sub = user;
      const done = await callback(begin.headers.get("location")!, cookie);
      const personal = /#\/koffie\/([a-f0-9]{32}\.[a-f0-9]{64})$/.exec(done.headers.get("location")!);
      assert.ok(personal, done.headers.get("location")!);
      return personal[1];
    };
    try {
      // Bind (Dana), then the admin turns reviews on with a five-minute window.
      const begin = await navigate("/auth/slack/channel/C00000001");
      const bound = await callback(begin.headers.get("location")!, begin.headers.get("set-cookie")!.split(";")[0]);
      const [, admin, requester] = /#\/koffie-beheer\/([a-f0-9.]+)\/([a-f0-9.]+)$/.exec(bound.headers.get("location")!)!;
      // Every binding, existing ones too, starts with reviews on and 15 minutes.
      assert.deepEqual((await status(requester)).reviews, { enabled: true, minutes: 15 });
      assert.equal((await api(requester, { type: "setReviews", enabled: true, minutes: 5 })).status, 403);
      assert.equal((await api(admin, { type: "setReviews", enabled: true, minutes: 7 })).status, 400);
      assert.deepEqual((await status(admin, { type: "setReviews", enabled: true, minutes: 5 })).reviews, { enabled: true, minutes: 5 });

      // A personal login needs the channel link in a POST body from an allowed origin.
      const refused = async (response: Response) => {
        assert.equal(response.status, 303);
        assert.equal(response.headers.get("location"), `${origin}/#/koffie-login/expired`);
      };
      await refused(await memberStart(`capability=${requester}`, { Origin: "https://evil.example" }));
      await refused(await memberStart(`capability=${requester.slice(0, 33)}${"0".repeat(64)}`));
      await refused(await memberStart(`capability=${requester}&extra=1`));
      await refused(await memberStart(`capability=${requester}`, { "Content-Type": "application/json" }));
      assert.equal((await navigate(`/auth/slack/member`)).status, 405);
      const alice = await login(requester, "U00000001");
      const bob = await login(requester, "U00000002");
      const carol = await login(admin, "U00000003");
      const dana = await login(requester, "U00000007");
      // A fresh login replaces the old personal link of that person.
      const bobAgain = await login(alice, "U00000002");
      assert.equal((await api(bob)).status, 404);
      const aliceStatus = await status(alice);
      assert.equal(aliceStatus.role, "member");
      // Members never request rounds or manage the binding.
      assert.equal((await api(alice, { type: "requestRound", minutes: 5 })).status, 400);
      for (const command of [{ type: "unbind" }, { type: "rotateRequestLink" }, { type: "setReviews", enabled: false, minutes: 5 }])
        assert.equal((await api(alice, command)).status, 403);
      assert.equal((await api(requester, { type: "review", drawId: "x", scores: [5], texts: [""] })).status, 403);
      const namespace = await mf.getDurableObjectNamespace("CHANNELS");
      const channel = namespace.get(namespace.idFromName(admin.split(".")[0])) as unknown as { stored(): Promise<string> };
      // The channel keeps hashes and pseudonyms only: no Slack identity, no raw personal link.
      for (const secret of ["U0000000", alice.split(".")[1], bobAgain.split(".")[1]])
        assert.ok(!(await channel.stored()).includes(secret), secret);

      // A round with reviews: the call links the channel page to log in.
      await koffierad();
      const round = (await status(requester)).round!;
      assert.equal(round.reviews, true);
      const call = posts.at(-1)!;
      assert.ok(JSON.stringify(call.blocks).includes(`{"type":"link","url":"${origin}/#/koffie/${requester}","text":"Open de ronde"}`));
      // Before the draw, only you learn whether you joined.
      const sessions = await mf.getDurableObjectNamespace("SESSIONS");
      const session = sessions.get(sessions.idFromName(await wordLocator(round.spectatorCapability))) as unknown as {
        stored(): Promise<string>;
        due(): Promise<void>;
        land(): Promise<void>;
        run(): Promise<void>;
      };
      await session.due();
      const drawn = JSON.parse(await session.stored());
      const winnerId = drawn.session.activeDraw.spins[0].winnerId;
      const winnerName = drawn.session.participants.find((p: { id: string }) => p.id === winnerId).name as string;
      const links: Record<string, string> = { Alice: alice, Bob: bobAgain, Carol: carol };
      const winner = links[winnerName];
      const voters = Object.entries(links).filter(([name]) => name !== winnerName);
      // While the wheel spins nobody gets a ballot naming the winner.
      assert.equal((await status(voters[0][1])).member?.ballot, undefined);
      await session.land();
      // Dana logged in but never reacted: no ballot. The winner: none either.
      assert.deepEqual((await status(dana)).member, {});
      assert.equal((await status(winner)).member?.ballot, undefined);
      const ballot = (await status(voters[0][1])).member!.ballot!;
      assert.deepEqual(ballot.winners, [{ index: 0, name: winnerName }]);
      assert.equal(ballot.submitted, false);
      // Shared screens see counts only.
      const snapshot = async () => {
        const r = await mf.dispatchFetch("http://localhost/api/session", {
          headers: { Origin: origin, Authorization: `Bearer ${round.spectatorCapability}` },
        });
        return ((await r.json()) as { session: PublicBeerWheelSession }).session;
      };
      assert.equal((await snapshot()).review?.voted, 0);
      assert.equal((await snapshot()).review?.eligible, 2);
      // The call now invites to review, with the channel page link.
      const invited = updates.at(-1)!;
      assert.match(String(invited.text), /Beoordeel de haler tot \d\d:\d\d/);
      assert.ok(JSON.stringify(invited.blocks).includes('"text":"Open de ronde"'));

      const vote = (cap: string, scores: unknown[], texts: unknown[] = [""]) =>
        api(cap, { type: "review", drawId: ballot.drawId, scores, texts });
      assert.equal((await vote(winner, [5])).status, 403);
      assert.equal((await vote(dana, [5])).status, 403);
      assert.equal((await vote(voters[0][1], [6])).status, 400);
      assert.equal((await vote(voters[0][1], [5], ["x".repeat(281)])).status, 400);
      const text = "<!channel> Perfecte flat white & op tijd";
      assert.equal((await vote(voters[0][1], [5], [text])).status, 200);
      assert.equal((await vote(voters[0][1], [1])).status, 409);
      assert.equal((await status(voters[0][1])).member?.ballot?.submitted, true);
      assert.equal((await snapshot()).review?.voted, 1);
      // The last vote closes at once: the anonymous post and the rated call follow.
      const before = posts.length;
      assert.equal((await vote(voters[1][1], [4])).status, 200);
      await session.run();
      assert.equal(posts.length, before + 1);
      const review = posts.at(-1)!;
      assert.equal(review.thread_ts, invited.ts);
      assert.equal(review.reply_broadcast, false);
      assert.ok(!String(review.text).includes("<!channel>"));
      // The winner is a real mention in the fallback, so Slack notifies them.
      assert.match(String(review.text), /^⭐ Reviews voor <@U[A-Z0-9]+>\n/);
      assert.ok(JSON.stringify(review.blocks).includes(JSON.stringify({ type: "rich_text_section", elements: [{ type: "text", text }] })));
      assert.match(String(review.text), /:star::star::star::star::bierrad_star_5: {2}4\.5 gemiddeld · 2 beoordelingen/);
      const rated = updates.at(-1)!;
      assert.match(String(rated.text), /haalde koffie · :star::star::star::star::bierrad_star_5: 4\.5$/);
      assert.ok(JSON.stringify(rated.blocks).includes("2 beoordelingen in de thread"));
      assert.ok(!JSON.stringify(rated).includes(requester));
      // Afterwards the session keeps no votes, texts, pseudonyms, key or link;
      // only the stars for the result page, until the session expires.
      const kept = await session.stored();
      for (const secret of ["Perfecte", requester, '"key"', '"eligible"', '"voted"', '"totals"', '"pseudonym"'])
        assert.ok(!kept.includes(secret), secret);
      assert.equal((await vote(voters[0][1], [5])).status, 409);
      const after = await snapshot();
      assert.equal(after.review, undefined);
      assert.equal(after.reviewOutcomes?.length, 1);
      assert.equal(after.reviewOutcomes![0].average, 4.5);
      assert.equal(after.reviewOutcomes![0].count, 2);
      for (const secret of ["U0", "Perfecte"])
        assert.ok(!JSON.stringify(after).includes(secret), secret);

      // Log out ends that personal link only; rotation ends all of them.
      assert.deepEqual(await (await api(carol, { type: "logout" })).json(), { type: "loggedOut" } satisfies ChannelCommandResult);
      assert.equal((await api(carol)).status, 404);
      assert.equal((await api(alice)).status, 200);
      await status(admin, { type: "rotateRequestLink" });
      for (const cap of [alice, bobAgain, dana]) assert.equal((await api(cap)).status, 404);
    } finally {
      await mf.dispose();
    }
  },
);
