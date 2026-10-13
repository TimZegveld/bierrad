import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { wordLocator } from "../auth";
import { SlackApiClient } from "../slack/api";
import { SlackReactionParticipantSource, type SlackPerson } from "../slack/source";
import { addGoal, queueResult, reconcile, resultBody } from "../slack/state";
import { newSession, publicSession, type StoredSession } from "../session";
import { feestCallBody, joinBody, settledCallBody } from "../channel/messages";
import { startDraw } from "../../src/domain/drawEngine";
import { validGoals, type ChannelCommandResult } from "../../shared/channel";
import type { PublicBeerWheelSession } from "../../shared/protocol";

const now = Date.parse("2026-10-13T12:00:00Z");
const source = { channelId: "C00000001", parentMessageTs: "1234567890.123456", reactionName: "coffee" as const };
const person = (slackId: string, name: string, reaction?: "coffee" | "droplet" | "cookie"): SlackPerson =>
  reaction ? { slackId, name, reaction } : { slackId, name };

function coffeeRound(people: SlackPerson[] = [person("U00000001", "Alice"), person("U00000002", "Bob")]) {
  const r = newSession("host", "viewer", now, "coffee");
  r.preferredCount = 1;
  r.slack = { grantHash: "synthetic", mapping: {}, channelRound: true, source };
  reconcile(r, source, people, now);
  return r;
}
const timing = { id: "draw", startAt: new Date(now).toISOString() };

test("goals are known Koffierad wheels, each once, with a word only for koek", () => {
  assert.deepEqual(validGoals([{ variant: "coffee" }, { variant: "cookie", title: "Taart" }]), [
    { variant: "coffee" },
    { variant: "cookie", title: "taart" },
  ]);
  for (const goals of [
    [{ variant: "coffee" }],
    [{ variant: "coffee" }, { variant: "coffee" }],
    [{ variant: "coffee" }, { variant: "beer" }],
    [{ variant: "coffee", title: "taart" }, { variant: "water" }],
    [{ variant: "coffee" }, { variant: "cookie", title: "<!channel>" }],
    [{ variant: "coffee" }, { variant: "water" }, { variant: "cookie" }, { variant: "coffee" }],
  ])
    assert.equal(validGoals(goals), undefined, JSON.stringify(goals));
});

test("the source reads every goal's emoji from the one call, nominations only with koek", async () => {
  const reactions = [
    { name: "coffee", count: 3, users: ["UBOT00001", "U00000001", "U00000002"] },
    { name: "droplet", count: 1, users: ["U00000001"] },
    { name: "cookie", count: 1, users: ["U00000003"] },
    { name: "carol-koek", count: 1, users: ["U00000001"] },
    { name: "beers", count: 1, users: ["U00000004"] },
  ];
  const lookups: string[] = [];
  const api = new SlackApiClient("synthetic", (async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("reactions.get"))
      return Response.json({ ok: true, type: "message", channel: source.channelId, message: { ts: source.parentMessageTs, reactions } });
    const id = url.searchParams.get("user")!;
    lookups.push(id);
    return Response.json({ ok: true, user: { id, profile: { display_name: { U00000001: "Alice", U00000002: "Bob", U00000003: "Carol" }[id] } } });
  }) as typeof fetch);
  const read = new SlackReactionParticipantSource(api);
  const two = await read.getParticipants(source, ["UBOT00001"], ["coffee", "droplet"]);
  assert.deepEqual(two, [
    person("U00000001", "Alice", "coffee"),
    person("U00000002", "Bob", "coffee"),
    person("U00000001", "Alice", "droplet"),
  ]);
  // Each person is looked up once, whatever they joined; beer and the bot never.
  assert.deepEqual(lookups.sort(), ["U00000001", "U00000002"]);
  const three = await read.getParticipants(source, ["UBOT00001"], ["coffee", "droplet", "cookie"]);
  assert.deepEqual(three.filter((p) => p.cookieReaction), [{ slackId: "U00000001", name: "Carol", cookieReaction: "carol-koek" }]);
  assert.deepEqual(three.filter((p) => p.reaction === "cookie"), [person("U00000003", "Carol", "cookie")]);
  // One reaction reads exactly as before: no goal tags.
  assert.deepEqual(await read.getParticipants(source, ["UBOT00001"]), [person("U00000001", "Alice"), person("U00000002", "Bob")]);
  for (const goals of [[], ["coffee", "coffee"], ["coffee", "invalid"]] as never[])
    await assert.rejects(read.getParticipants(source, [], goals));
});

test("a joining goal turns a waiting round into a Feestrad without losing anyone", () => {
  const r = coffeeRound();
  const before = r.session.participants.map((p) => p.id);
  addGoal(r, { variant: "water" });
  assert.deepEqual(r.goals, [{ variant: "coffee" }, { variant: "water" }]);
  assert.deepEqual(r.session.goals!.map((g) => [g.variant, g.participantIds]), [
    ["coffee", before],
    ["water", []],
  ]);
  addGoal(r, { variant: "cookie", title: "taart" });
  assert.deepEqual(r.goals!.at(-1), { variant: "cookie", title: "taart" });
  assert.equal(r.session.winnerCount, 3);
});

test("a Feestrad imports one participant per person and one pool per goal; nominations only size koek", () => {
  const r = coffeeRound();
  addGoal(r, { variant: "water" });
  addGoal(r, { variant: "cookie" });
  const alice = r.slack!.mapping.U00000001;
  reconcile(r, source, [
    person("U00000001", "Alice", "coffee"),
    person("U00000002", "Bob", "coffee"),
    person("U00000001", "Alice", "droplet"),
    person("U00000003", "Carol", "cookie"),
    person("U00000002", "Bob", "cookie"),
    { slackId: "U00000001", name: "Carol", cookieReaction: "carol-koek" },
  ], now);
  const s = r.session;
  assert.deepEqual(s.participants.map((p) => p.name), ["Alice", "Bob", "Carol"]);
  assert.ok(s.participants.every((p) => !p.weight));
  // Stable identities across reads.
  assert.equal(r.slack!.mapping.U00000001, alice);
  const id = (slackId: string) => r.slack!.mapping[slackId];
  assert.deepEqual(s.goals!.map((g) => g.participantIds), [
    [id("U00000001"), id("U00000002")],
    [id("U00000001")],
    [id("U00000002"), id("U00000003")],
  ]);
  assert.deepEqual(s.goals![2].weights, [1, 2]);
  assert.deepEqual(r.slack!.cookieSponsors, { [id("U00000003")]: ["U00000001"] });
  // The public DTO carries the pools, never Slack IDs.
  const dto = publicSession(r);
  assert.equal(dto.goals?.length, 3);
  assert.ok(!JSON.stringify(dto).includes("U0000000"));
});

function drawnFeest(): StoredSession {
  const r = coffeeRound();
  addGoal(r, { variant: "water" });
  addGoal(r, { variant: "cookie", title: "taart" });
  reconcile(r, source, [
    person("U00000001", "Alice", "coffee"),
    person("U00000002", "Bob", "coffee"),
    person("U00000001", "Alice", "droplet"),
    person("U00000002", "Bob", "cookie"),
    person("U00000003", "Carol", "cookie"),
  ], now);
  r.scheduledDraw = { startAt: timing.startAt, status: "pending" };
  r.session = startDraw(r.session, timing);
  queueResult(r);
  return r;
}

test("the joint draw gives each goal its own winner; the result names their goal", () => {
  const r = drawnFeest();
  const draw = r.session.activeDraw!;
  // Alice is the only one for water, so Bob gets coffee and Carol the taart.
  const names = draw.spins.map((s) => r.session.participants.find((p) => p.id === s.winnerId)!.name);
  assert.deepEqual(names, ["Bob", "Alice", "Carol"]);
  assert.deepEqual(draw.spins[1].participantIds, [r.slack!.mapping.U00000001]);
  const job = r.slack!.job!;
  assert.deepEqual(job.goals, [{ variant: "coffee" }, { variant: "water" }, { variant: "cookie", title: "taart" }]);
  const body = resultBody(job);
  assert.equal(
    body.text,
    "🌈 Het Feestrad heeft gesproken!\n☕ <@U00000002> haalt koffie\n💧 <@U00000001> haalt water\n🍪 <@U00000003> haalt taart\nNiemand hoeft er twee te halen. Proost!",
  );
  assert.equal(body.reply_broadcast, false);
  // The settled call: one line per goal, the winner as a mention.
  const card = r.slack!.card!;
  assert.equal(card.kind, "winner");
  const settled = settledCallBody("C00000001", source.parentMessageTs, now, "coffee", card, undefined, undefined, undefined, r.goals);
  assert.match(settled.text, /^🌈 Feestronde om \d\d:\d\d\n☕ Bob haalt koffie\n💧 Alice haalt water\n🍪 Carol haalt taart$/);
  assert.ok(JSON.stringify(settled.blocks).includes('"user_id":"U00000002"'));
});

test("a goal nobody is left for says so in the settled call", () => {
  const r = coffeeRound([person("U00000001", "Alice")]);
  addGoal(r, { variant: "water" });
  reconcile(r, source, [person("U00000001", "Alice", "coffee"), person("U00000001", "Alice", "droplet")], now);
  r.scheduledDraw = { startAt: timing.startAt, status: "pending" };
  r.session = startDraw(r.session, timing);
  queueResult(r);
  const settled = settledCallBody("C00000001", source.parentMessageTs, now, "coffee", r.slack!.card!, undefined, undefined, undefined, r.goals);
  assert.ok(/Alice haalt (koffie|water)/.test(settled.text));
  assert.ok(/Niemand meer over voor (water|koffie)/.test(settled.text));
});

test("the joining announcement is the one broadcast; the call is rewritten with fixed text and the same link", () => {
  const goals = [{ variant: "coffee" as const }, { variant: "water" as const }];
  const join = joinBody("C00000001", source.parentMessageTs, goals, now);
  assert.equal(join.reply_broadcast, true);
  assert.equal(join.thread_ts, source.parentMessageTs);
  assert.equal(join.mrkdwn, false);
  assert.equal(join.parse, "none");
  assert.match(join.text, /^💧 Er komt een Waterrad bij! Het Koffierad wordt een Feestrad 🌈\nKlik op 💧 onder de oproep om water te halen\. Het rad draait om \d\d:\d\d\.$/);
  const grown = joinBody("C00000001", source.parentMessageTs, [...goals, { variant: "cookie", title: "taart" }], now);
  assert.match(grown.text, /^🍪 Er komt een Taartrad bij! Het Feestrad groeit 🌈/);
  const call = feestCallBody("C00000001", source.parentMessageTs, "https://example.test/#/koffie/a-b-c-d-e", "Kijk live mee", now, [...goals, { variant: "cookie", title: "taart" }]);
  assert.equal(call.ts, source.parentMessageTs);
  assert.match(call.text, /^🌈 Feestronde om \d\d:\d\d\nKlik hieronder op wat je wilt halen: ☕ koffie · 💧 water · 🍪 taart\.\nMeedoen voor meer mag, maar je wint er hooguit één\.\nhttps:\/\/example\.test/);
  assert.equal(call.mrkdwn, false);
  assert.equal((call as Record<string, unknown>).reply_broadcast, undefined);
});

const signingSecret = "synthetic-signing-secret";
const sign = (body: string, at = Math.floor(Date.now() / 1000)) => ({
  "X-Slack-Request-Timestamp": String(at),
  "X-Slack-Signature": "v0=" + createHmac("sha256", signingSecret).update(`v0:${at}:${body}`).digest("hex"),
});

test(
  "a waiting Koffierad round grows into a Feestrad from /waterrad and /koekrad, with one joint draw",
  { timeout: 60000 },
  async () => {
    const script = await readFile("worker-dist/index.js", "utf8");
    const clientId = "1000000000.2000000000";
    let nonce = "";
    let postMode = "success";
    let ts = 1234567890100000;
    const posts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const reactionsAdded: Record<string, unknown>[] = [];
    const names: Record<string, string> = { U00000001: "Alice", U00000002: "Bob", U00000003: "Carol" };
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "feestrad-test",
            modules: true,
            script:
              script +
              `\nexport class TestSession extends LiveSession {
      edit(fn) { const r = JSON.parse(this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value); fn(r); this.ctx.storage.sql.exec('UPDATE session SET value = ? WHERE singleton = 1', JSON.stringify(r)); }
      async due() { this.edit(r => { r.scheduledDraw.startAt = new Date(Date.now() + 4000).toISOString(); }); return this.alarm(); }
      async postNow() { this.edit(r => { if (r.slack.job) r.slack.job.readyAt = 0; if (r.slack.card) r.slack.card.readyAt = Date.now() - 1; }); return this.alarm(); }
    }
    export class TestChannel extends ChannelWheel {
      stored() { return this.ctx.storage.sql.exec('SELECT value FROM binding WHERE singleton = 1').toArray()[0]?.value ?? null; }
      startAt(at) { const b = JSON.parse(this.stored()); const was = b.round.startAt; b.round.startAt = at; this.ctx.storage.sql.exec('UPDATE binding SET value = ? WHERE singleton = 1', JSON.stringify(b)); return was; }
    }`,
            compatibilityDate: "2026-09-25",
            compatibilityFlags: ["nodejs_compat"],
            durableObjects: {
              SESSIONS: { className: "TestSession", useSQLite: true },
              CHANNELS: { className: "TestChannel", useSQLite: true },
            },
            bindings: {
              ALLOWED_ORIGINS: "http://127.0.0.1:5173",
              FRONTEND_URL: "http://127.0.0.1:5173/",
              COFFEE_SLACK_BOT_TOKEN: "synthetic-coffee-credential",
              COFFEE_SLACK_CLIENT_ID: clientId,
              COFFEE_SLACK_CLIENT_SECRET: "synthetic-coffee-client-secret",
              COFFEE_SLACK_SIGNING_SECRET: signingSecret,
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
                  id_token: `${part({})}.${part({ iss: "https://slack.com", aud: clientId, exp: Math.floor(Date.now() / 1000) + 300, nonce, sub: "U00000007", "https://slack.com/team_id": "T00000001" })}.c2ln`,
                });
              }
              if (path === "auth.revoke") return Response.json({ ok: true });
              if (path === "auth.test") return Response.json({ ok: true, team_id: "T00000001", user_id: "UBOT00001" });
              if (path === "users.info") {
                const id = url.searchParams.get("user")!;
                return Response.json({ ok: true, user: { id, team_id: "T00000001", deleted: false, is_bot: false, profile: { display_name: names[id] ?? "Binder" } } });
              }
              if (path === "reactions.add") {
                reactionsAdded.push((await req.json()) as Record<string, unknown>);
                return Response.json({ ok: true });
              }
              if (path === "reactions.get")
                return Response.json({
                  ok: true,
                  type: "message",
                  channel: "C00000001",
                  message: {
                    ts: url.searchParams.get("timestamp"),
                    reactions: [
                      { name: "coffee", count: 3, users: ["UBOT00001", "U00000001", "U00000002"] },
                      { name: "droplet", count: 2, users: ["UBOT00001", "U00000001"] },
                      { name: "cookie", count: 3, users: ["UBOT00001", "U00000002", "U00000003"] },
                    ],
                  },
                });
              if (path === "chat.update") {
                const body = (await req.json()) as Record<string, unknown>;
                updates.push(body);
                return Response.json({ ok: true, channel: body.channel, ts: body.ts });
              }
              assert.equal(path, "chat.postMessage");
              const body = (await req.json()) as Record<string, unknown>;
              posts.push(body);
              if (postMode === "reject") return Response.json({ ok: false, error: "not_in_channel" });
              ts++;
              return Response.json({ ok: true, channel: body.channel, ts: `${String(ts).slice(0, 10)}.${String(ts).slice(10)}` });
            },
          },
        ],
      }),
    );
    const api = async (cap: string, body?: object) => {
      const response = await mf.dispatchFetch("http://localhost/api/channel", {
        method: body ? "POST" : "GET",
        headers: { Origin: "http://127.0.0.1:5173", Authorization: `Bearer ${cap}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      assert.equal(response.status, 200);
      return (await response.json()) as ChannelCommandResult & { status: Record<string, never> };
    };
    const navigate = (path: string, cookie?: string) =>
      mf.dispatchFetch(`http://localhost${path}`, { redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
    const slash = async (fields: Record<string, string>) => {
      const body = new URLSearchParams({ command: "/koffierad", user_id: "U00000001", channel_id: "C00000001", team_id: "T00000001", text: "", ...fields }).toString();
      const response = await mf.dispatchFetch("http://localhost/slack/commands", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...sign(body) },
        body,
      });
      assert.equal(response.status, 200);
      const text = await response.text();
      return text ? (JSON.parse(text) as { text: string }).text : "";
    };
    try {
      const begin = await navigate("/auth/slack/channel/C00000001");
      const authorize = new URL(begin.headers.get("location")!);
      nonce = authorize.searchParams.get("nonce")!;
      const bound = await navigate(
        `/auth/slack/callback?code=synthetic-code&state=${authorize.searchParams.get("state")}`,
        begin.headers.get("set-cookie")!.split(";")[0],
      );
      assert.match(String(bound.headers.get("location")), /koffie-beheer/);
      const [, admin, requester] = /#\/koffie-beheer\/([a-f0-9.]+)\/([a-f0-9.]+)$/.exec(bound.headers.get("location")!)!;
      await api(admin, { type: "setReviews", enabled: false, minutes: 15 });
      const channels = await mf.getDurableObjectNamespace("CHANNELS");
      const channel = channels.get(channels.idFromName(admin.split(".")[0])) as unknown as { startAt(at: number): Promise<number> };

      assert.equal(await slash({ text: "5" }), "");
      const call = posts.at(-1)!;
      const callTs = reactionsAdded.at(-1)!.timestamp as string;
      const start = (await api(requester)).status.round as { startAt: string; spectatorCapability: string };
      assert.equal(updates.length, 0);

      // Less than a minute before the start nothing joins any more.
      const planned = await channel.startAt(Date.now() + 30000);
      assert.match(await slash({ command: "/waterrad" }), /^💧 Te laat om aan te haken: het rad draait om \d\d:\d\d\./);
      await channel.startAt(planned);
      assert.equal(posts.at(-1), call);

      // /waterrad joins: a broadcast in the thread, 💧 on the call, the call rewritten.
      assert.equal(await slash({ command: "/waterrad", text: "10" }), "");
      const announced = posts.at(-1)!;
      assert.equal(announced.thread_ts, callTs);
      assert.equal(announced.reply_broadcast, true);
      assert.match(String(announced.text), /^💧 Er komt een Waterrad bij! Het Koffierad wordt een Feestrad 🌈/);
      assert.deepEqual(reactionsAdded.at(-1), { channel: "C00000001", timestamp: callTs, name: "droplet" });
      assert.equal(updates.length, 1);
      assert.equal(updates[0].ts, callTs);
      assert.match(String(updates[0].text), /^🌈 Feestronde om \d\d:\d\d\nKlik hieronder op wat je wilt halen: ☕ koffie · 💧 water\./);
      // The same link as the call, never another capability.
      const link = /"url":"([^"]+)"/.exec(JSON.stringify(call.blocks))![1];
      assert.ok(JSON.stringify(updates[0].blocks).includes(`"url":"${link}"`));
      // The minutes of a joining command change nothing: the round keeps its time.
      const grown = (await api(requester)).status as { round: { startAt: string; goals?: object[] }; roundsLeft: number };
      assert.equal(grown.round.startAt, start.startAt);
      assert.deepEqual(grown.round.goals, [{ variant: "coffee" }, { variant: "water" }]);
      assert.equal(grown.roundsLeft, 23);

      // The same wheel twice is refused and named as a Feestrad.
      assert.match(await slash({ command: "/waterrad" }), /^🌈 Er loopt al een feestronde in dit kanaal, met ☕ 💧/);
      assert.match(await slash({}), /^🌈 Er loopt al een feestronde/);

      // A refused announcement undoes the goal.
      postMode = "reject";
      assert.match(await slash({ command: "/koekrad", text: "taart" }), /kon niet in dit kanaal posten/);
      postMode = "success";
      assert.equal(((await api(requester)).status as { round: { goals: object[] } }).round.goals.length, 2);
      const sessions = await mf.getDurableObjectNamespace("SESSIONS");
      const session = sessions.get(sessions.idFromName(await wordLocator(start.spectatorCapability))) as unknown as {
        due(): Promise<void>;
        postNow(): Promise<void>;
      };
      const snapshot = async () => {
        const r = await mf.dispatchFetch("http://localhost/api/session", {
          headers: { Origin: "http://127.0.0.1:5173", Authorization: `Bearer ${start.spectatorCapability}` },
        });
        return ((await r.json()) as { session: PublicBeerWheelSession }).session;
      };
      assert.equal((await snapshot()).goals?.length, 2);

      // /koekrad taart joins as the third goal.
      assert.equal(await slash({ command: "/koekrad", text: "taart" }), "");
      assert.match(String(posts.at(-1)!.text), /^🍪 Er komt een Taartrad bij! Het Feestrad groeit 🌈/);
      assert.match(String(updates.at(-1)!.text), /☕ koffie · 💧 water · 🍪 taart/);
      assert.deepEqual((await snapshot()).goals?.map((g) => [g.variant, g.title]), [["coffee", undefined], ["water", undefined], ["cookie", "taart"]]);

      // The final check reads all three emoji; one joint draw, nobody twice.
      await session.due();
      const drawn = await snapshot();
      const winner = (i: number) => drawn.participants.find((p) => p.id === drawn.activeDraw!.spins[i].winnerId)!.name;
      assert.deepEqual([0, 1, 2].map(winner), ["Bob", "Alice", "Carol"]);
      assert.deepEqual(drawn.activeDraw!.spins.map((s) => s.participantIds?.length), [2, 1, 2]);
      assert.ok(!JSON.stringify(drawn).includes("U0000000"));
      await session.postNow();
      await session.postNow();
      assert.match(String(posts.at(-1)!.text), /^🌈 Het Feestrad heeft gesproken!\n☕ <@U00000002> haalt koffie\n💧 <@U00000001> haalt water\n🍪 <@U00000003> haalt taart/);
      assert.match(String(updates.at(-1)!.text), /^🌈 Feestronde om \d\d:\d\d\n☕ Bob haalt koffie\n💧 Alice haalt water\n🍪 Carol haalt taart$/);
      assert.equal(updates.at(-1)!.ts, callTs);
    } finally {
      await mf.dispose();
    }
  },
);
