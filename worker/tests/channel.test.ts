import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { hashSecret, randomHex, wordLocator } from "../auth";
import {
  parseSlashCommand,
  verifySlackSignature,
} from "../channel/slash";
import { boundBody, callBody, settledCallBody } from "../channel/messages";
import {
  channelRefreshAt,
  executeScheduledDraw,
  newSession,
  nextDeadline,
  START_DELAY_MS,
  type StoredSession,
} from "../session";
import { queueChannelNotice, queueResult, resultBody } from "../slack/state";
import { createSession, startDraw } from "../../src/domain/drawEngine";
import { SlackApiClient } from "../slack/api";
import { SlackReactionParticipantSource } from "../slack/source";
import { parseChannelInput, roundStartAt } from "../../shared/channel";
import type { ChannelCommandResult } from "../../shared/channel";
import type { PublicBeerWheelSession } from "../../shared/protocol";

const signingSecret = "synthetic-signing-secret";
const sign = (body: string, at = Math.floor(Date.now() / 1000)) => ({
  "X-Slack-Request-Timestamp": String(at),
  "X-Slack-Signature":
    "v0=" +
    createHmac("sha256", signingSecret).update(`v0:${at}:${body}`).digest("hex"),
});
const slashBody = (fields: Record<string, string>) =>
  new URLSearchParams({
    command: "/koffierad",
    user_id: "U00000001",
    channel_id: "C00000001",
    team_id: "T00000001",
    text: "",
    ...fields,
  }).toString();

test("slash requests need a fresh signature over the exact body", async () => {
  const body = slashBody({});
  const ok = (headers: Record<string, string>, raw = body, secret = signingSecret) =>
    verifySlackSignature(secret, new Headers(headers), raw);
  assert.equal(await ok(sign(body)), true);
  assert.equal(await ok(sign(body), body + "&text=5"), false);
  assert.equal(await ok(sign(body), body, "other-secret"), false);
  assert.equal(await ok(sign(body), body, ""), false);
  assert.equal(await ok(sign(body, Math.floor(Date.now() / 1000) - 301)), false);
  assert.equal(await ok({ ...sign(body), "X-Slack-Signature": "v0=abc" }), false);
  assert.equal(await ok({ "X-Slack-Signature": sign(body)["X-Slack-Signature"] }), false);
});

test("slash command text is strict: minutes, help or nothing", () => {
  const parse = (fields: Record<string, string>) => parseSlashCommand(slashBody(fields));
  assert.deepEqual(parse({}), { kind: "round", variant: "coffee", channelId: "C00000001", userId: "U00000001" });
  // /waterrad belongs to the same app and binding; only the variant differs.
  assert.deepEqual(parse({ command: "/waterrad", text: "10" }), {
    kind: "round",
    variant: "water",
    channelId: "C00000001",
    userId: "U00000001",
    minutes: 10,
  });
  assert.deepEqual(parse({ command: "/waterrad", text: "hulp" }), { kind: "help", variant: "water" });
  // /koekrad takes one optional word before the optional minutes.
  const cookie = { kind: "round", variant: "cookie", channelId: "C00000001", userId: "U00000001" };
  assert.deepEqual(parse({ command: "/koekrad" }), cookie);
  assert.deepEqual(parse({ command: "/koekrad", text: "5" }), { ...cookie, minutes: 5 });
  assert.deepEqual(parse({ command: "/koekrad", text: "koek" }), { ...cookie, title: "koek" });
  assert.deepEqual(parse({ command: "/koekrad", text: "koek 5" }), { ...cookie, minutes: 5, title: "koek" });
  assert.deepEqual(parse({ command: "/koekrad", text: " Taart  10 min " }), { ...cookie, minutes: 10, title: "taart" });
  assert.deepEqual(parse({ command: "/koekrad", text: "crème-brûlée 3m" }), { ...cookie, minutes: 3, title: "crème-brûlée" });
  assert.deepEqual(parse({ command: "/koekrad", text: "ijs" }), { ...cookie, title: "ijs" });
  assert.equal((parse({ command: "/koekrad", text: "ab" }) as { title?: string }).title, "ab");
  assert.equal((parse({ command: "/koekrad", text: "a".repeat(20) }) as { title?: string }).title, "a".repeat(20));
  // Anything that is not one plain word gets the help text: no mentions, links, emoji, markup or digits.
  for (const text of [
    "help",
    "a 5",
    "a".repeat(21),
    "appel taart 5",
    "5 koek",
    "koek5",
    "<!channel>",
    "<!here> 5",
    "@koek",
    ":cookie:",
    "*koek*",
    "_koek_",
    "~koek~",
    "`koek`",
    "koek.nl",
    "https://x",
    "koek/taart",
    "koek&taart",
    "-koek",
    "koek-",
    "koek--taart",
    "koek'",
    "k\u00f6ek\u200b",
  ])
    assert.equal(parse({ command: "/koekrad", text }).kind, "help", text);
  // Only the Koekrad takes a word.
  assert.equal(parse({ text: "koek 5" }).kind, "help");
  assert.equal(parse({ command: "/waterrad", text: "koek" }).kind, "help");
  assert.equal(parse({ command: "/Waterrad" }).kind, "invalid");
  assert.equal(parse({ command: "/waterrad", channel_id: "D00000001" }).kind, "wrongChannel");
  assert.equal((parse({ text: "10" }) as { minutes: number }).minutes, 10);
  assert.equal((parse({ text: " 7 min " }) as { minutes: number }).minutes, 7);
  assert.equal(parse({ text: "help" }).kind, "help");
  assert.equal(parse({ text: "<!channel> 5" }).kind, "help");
  assert.equal(parse({ text: "100" }).kind, "help");
  assert.equal(parse({ channel_id: "D00000001" }).kind, "wrongChannel");
  assert.equal(parse({ command: "/bierrad" }).kind, "invalid");
  assert.equal(parse({ user_id: "nope" }).kind, "invalid");
  assert.equal(
    parseSlashCommand(slashBody({}) + "&channel_id=C00000002").kind,
    "invalid",
  );
  // The channel name is display only: kept when it looks like a Slack name, dropped otherwise.
  assert.equal((parse({ channel_name: "koffie-3e_etage" }) as { channelName?: string }).channelName, "koffie-3e_etage");
  assert.equal((parse({ channel_name: "koffie", text: "5" }) as { channelName?: string }).channelName, "koffie");
  for (const name of ["", "Koffie", "<b>x</b>", "privategroup", "directmessage", "mpdm-a--b-1", "a".repeat(81), "naam met spatie"])
    assert.equal((parse({ channel_name: name }) as { channelName?: string }).channelName, undefined, name);
});

test("channel input accepts only Slack channel IDs and links", () => {
  assert.equal(parseChannelInput("C00000001"), "C00000001");
  assert.equal(
    parseChannelInput("https://acme.slack.com/archives/G00000001/p1234567890123456"),
    "G00000001",
  );
  assert.equal(
    parseChannelInput("https://app.slack.com/client/T00000001/C00000001"),
    "C00000001",
  );
  for (const bad of [
    "D00000001",
    "https://evil.example/archives/C00000001",
    "http://acme.slack.com/archives/C00000001",
    "#koffie",
  ])
    assert.equal(parseChannelInput(bad), null, bad);
});

test("rounds start on the next whole minute, never sooner than asked", () => {
  const minute = Date.parse("2026-10-05T13:03:00Z");
  assert.equal(roundStartAt(minute + 37000, 5), minute + 6 * 60000);
  assert.equal(roundStartAt(minute + 1, 1), minute + 2 * 60000);
  assert.equal(roundStartAt(minute, 5), minute + 5 * 60000);
  for (const now of [minute + 1, minute + 59999])
    assert.ok(roundStartAt(now, 3) - now >= 3 * 60000);
});

test("channel messages are fixed text with server-built links, never broadcast or unfurled", () => {
  const link = "https://example.test/#/live/one-two-three-four-five";
  const now = Date.parse("2026-10-05T08:00:00Z");
  const call = callBody("C00000001", link, now + 5 * 60000);
  // A bold title with the fixed start time, one action line and a quiet note.
  assert.equal(call.text, "☕ Koffieronde om 10:05\nKlik op ☕ hieronder om mee te doen.\n" + link);
  assert.equal(call.unfurl_links, false);
  assert.equal(call.link_names, false);
  assert.equal("thread_ts" in call, false);
  assert.equal("reply_broadcast" in call, false);
  const section = call.blocks[0].elements![0].elements;
  assert.deepEqual(section[0], { type: "text", text: "☕ Koffieronde om 10:05", style: { bold: true } });
  assert.deepEqual(section.at(-1), { type: "link", url: link, text: "Kijk live mee" });
  assert.deepEqual(call.blocks[1], {
    type: "context",
    elements: [{ type: "plain_text", text: "Het Koffierad kiest één koffiehaler.", emoji: true }],
  });
  const water = callBody("C00000001", link, now + 60000, "water");
  assert.match(water.text, /^💧 Waterronde om 10:01\nKlik op 💧 hieronder/);
  assert.doesNotMatch(JSON.stringify(water), /☕|koffie/i);
  assert.equal(water.unfurl_links, false);
  assert.equal("reply_broadcast" in water, false);
  // Koekrad calls take the round's word; without one they are koekrondes.
  const plain = callBody("C00000001", link, now + 60000, "cookie");
  assert.match(plain.text, /^🍪 Koekronde om 10:01\nKlik op 🍪 hieronder/);
  const taart = callBody("C00000001", link, now + 60000, "cookie", undefined, "taart");
  assert.match(taart.text, /^🍪 Taartronde om 10:01\nKlik op 🍪 hieronder/);
  assert.equal(taart.blocks[1].elements![0].text, "Het Taartrad kiest één taarthaler.");
  assert.equal(taart.mrkdwn, false);
  assert.equal(taart.unfurl_links, false);
  // A word is only ever validated text: anything else falls back to the plain Koekrad.
  const forged = callBody("C00000001", link, now + 60000, "cookie", undefined, "<!channel>");
  assert.match(forged.text, /^🍪 Koekronde om 10:01/);
  assert.doesNotMatch(JSON.stringify(forged), /channel>/);
  // Coffee and water never take a word.
  assert.match(callBody("C00000001", link, now + 60000, "coffee", undefined, "taart").text, /^☕ Koffieronde/);
  const settled = settledCallBody("C00000001", "1234567890.123456", now + 60000, "cookie", { kind: "empty" }, undefined, "taart");
  assert.match(settled.text, /^🍪 Taartronde om 10:01\nNiemand deed mee/);
  const bound = boundBody("C00000001", "https://example.test/#/koffie/abc");
  assert.match(bound.text, /\/koffierad/);
  assert.match(bound.text, /\/waterrad/);
  assert.match(bound.text, /\/koekrad/);
});

test("a settled round rewrites its own call: winner as mention, notices as fixed text, no link", () => {
  const startAt = Date.parse("2026-10-05T08:05:00Z");
  const won = settledCallBody("C00000001", "1234567890.123456", startAt, "coffee", {
    kind: "winner",
    names: ["<!channel> Nick"],
    mentionIds: ["U00000001"],
    participants: 7,
  });
  assert.equal(won.channel, "C00000001");
  assert.equal(won.ts, "1234567890.123456");
  assert.equal("thread_ts" in won, false);
  assert.equal("reply_broadcast" in won, false);
  assert.equal(won.parse, "none");
  // The fallback text is escaped; the block mentions only the frozen identity.
  assert.equal(won.text, "☕ Koffieronde om 10:05\n🏆 &lt;!channel&gt; Nick haalt koffie");
  assert.deepEqual(won.blocks[0].elements![0].elements.slice(2), [
    { type: "text", text: "🏆 " },
    { type: "user", user_id: "U00000001" },
    { type: "text", text: " haalt koffie" },
  ]);
  assert.equal(won.blocks[1].elements![0].text, "7 deden mee");
  assert.ok(!JSON.stringify(won).includes("example.test"));
  // Without a valid identity the name stays literal text.
  const plain = settledCallBody("C00000001", "1234567890.123456", startAt, "water", {
    kind: "winner",
    names: ["Bob"],
    mentionIds: [null],
    participants: 1,
  });
  assert.deepEqual(plain.blocks[0].elements![0].elements.slice(2), [
    { type: "text", text: "🏆 " },
    { type: "text", text: "Bob" },
    { type: "text", text: " haalt water" },
  ]);
  assert.equal(plain.blocks[1].elements![0].text, "1 deed mee");
  const empty = settledCallBody("C00000001", "1234567890.123456", startAt, "water", { kind: "empty" });
  assert.equal(empty.text, "💧 Waterronde om 10:05\nNiemand deed mee, dus het rad bleef stil. Dan maar zelf tappen!");
  assert.equal(empty.blocks.length, 1);
  const unreadable = settledCallBody("C00000001", "1234567890.123456", startAt, "coffee", { kind: "unreadable" });
  assert.match(unreadable.text, /^☕ Koffieronde om 10:05\nHet Koffierad kon de reacties niet lezen/);
});

test("channel rounds settle in their call: a card instead of thread notices or broadcasts", () => {
  const now = Date.parse("2026-10-05T08:00:00Z");
  const startAt = now + 300000;
  const source = { channelId: "C00000001", parentMessageTs: "1234567890.123456", reactionName: "coffee" as const };
  const round = (): StoredSession => {
    const r = newSession("host", "viewer", now, "coffee");
    r.preferredCount = 1;
    r.scheduledDraw = { startAt: new Date(startAt).toISOString(), status: "refreshing" };
    r.slack = { grantHash: "slack-channel", mapping: {}, source, channelRound: true, nextImportAt: now + 60000 };
    return r;
  };
  let r = round();
  executeScheduledDraw(r, now, true);
  assert.equal(r.slack!.job, undefined);
  assert.deepEqual(r.slack!.card, { kind: "empty", startAt, status: "pending", readyAt: now, attempts: 0 });
  assert.equal(nextDeadline(r), now);
  r = round();
  executeScheduledDraw(r, now, false);
  assert.equal(r.slack!.card?.kind, "unreadable");
  // Ordinary Slack sessions keep their old behaviour: no notice and no card.
  r = round();
  delete r.slack!.channelRound;
  executeScheduledDraw(r, now, true);
  assert.equal(r.slack!.job, undefined);
  assert.equal(r.slack!.card, undefined);
  queueChannelNotice(r, "empty", now);
  assert.equal(r.slack!.card, undefined);
  // A drawn round: the thread result is never broadcast and the call gets the winner.
  r = round();
  r.slack!.mapping = { U00000001: "p1", U00000002: "p2" };
  r.session = startDraw(createSession("s1", [{ id: "p1", name: "Alice" }, { id: "p2", name: "Bob" }], 1), { id: "d1", startAt: new Date(now + 4000).toISOString() });
  queueResult(r);
  const job = r.slack!.job!;
  assert.equal(resultBody(job).reply_broadcast, false);
  const card = r.slack!.card!;
  assert.equal(card.kind, "winner");
  assert.equal(card.startAt, startAt);
  assert.equal(card.readyAt, job.readyAt);
  assert.equal(card.kind === "winner" && card.participants, 2);
  assert.deepEqual(card.kind === "winner" && card.mentionIds, job.mentionIds);
  // Bierrad sessions (no channel round) get no card.
  delete r.slack!.card;
  delete r.slack!.channelRound;
  queueResult(r);
  assert.equal(r.slack!.card, undefined);
});

test("channel rounds refresh themselves, but never close to the final check", () => {
  const now = Date.parse("2026-10-05T08:00:00Z");
  const r = newSession("host", "viewer", now, "coffee");
  const startAt = now + 5 * 60000;
  r.scheduledDraw = { startAt: new Date(startAt).toISOString(), status: "pending" };
  r.slack = {
    grantHash: "slack-channel",
    mapping: {},
    source: { channelId: "C00000001", parentMessageTs: "1234567890.123456", reactionName: "coffee" },
    channelRound: true,
    nextImportAt: now + 60000,
  };
  assert.equal(channelRefreshAt(r), now + 60000);
  assert.equal(nextDeadline(r), now + 60000);
  r.slack.nextImportAt = startAt - START_DELAY_MS - 29000;
  assert.equal(channelRefreshAt(r), undefined);
  assert.equal(nextDeadline(r), startAt - START_DELAY_MS);
  delete r.slack.channelRound;
  r.slack.nextImportAt = now;
  assert.equal(channelRefreshAt(r), undefined);
});

test("the bot's own prefilled reaction never becomes a participant", async () => {
  const looked: string[] = [];
  const api = new SlackApiClient("synthetic", (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("reactions.get"))
      return Response.json({
        ok: true,
        type: "message",
        channel: "C00000001",
        message: {
          ts: "1234567890.123456",
          reactions: [{ name: "coffee", count: 2, users: ["UBOT00001", "U00000001"] }],
        },
      });
    looked.push(url.searchParams.get("user")!);
    return Response.json({ ok: true, user: { id: url.searchParams.get("user"), deleted: false, is_bot: false, profile: { display_name: "Alice" } } });
  }) as typeof fetch);
  const people = await new SlackReactionParticipantSource(api).getParticipants(
    { channelId: "C00000001", parentMessageTs: "1234567890.123456", reactionName: "coffee" },
    ["UBOT00001"],
  );
  assert.deepEqual(people.map((p) => p.slackId), ["U00000001"]);
  assert.deepEqual(looked, ["U00000001"]);
});

test(
  "Worker binds a channel, starts rounds from link and slash command, draws one winner without the bot",
  { timeout: 60000 },
  async () => {
    const script = await readFile("worker-dist/index.js", "utf8");
    const clientId = "1000000000.2000000000";
    let nonce = "";
    let postMode = "success";
    let ts = 1234567890100000;
    const posts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    let updateMode = "success";
    const reactionsAdded: Record<string, unknown>[] = [];
    const userLookups: string[] = [];
    const reactors = ["UBOT00001", "U00000001", "U00000002"];
    const drinkers = ["UBOT00001", "U00000003"];
    const bakers = ["UBOT00001", "U00000001"];
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "channel-test",
            modules: true,
            script:
              script +
              `\nexport class TestSession extends LiveSession {
      edit(fn) { const r = JSON.parse(this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value); fn(r); this.ctx.storage.sql.exec('UPDATE session SET value = ? WHERE singleton = 1', JSON.stringify(r)); }
      stored() { return this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value; }
      async due() { this.edit(r => { r.scheduledDraw.startAt = new Date(Date.now() + 4000).toISOString(); }); return this.alarm(); }
      async postNow() { this.edit(r => { if (r.slack.job) r.slack.job.readyAt = 0; if (r.slack.card) r.slack.card.readyAt = Date.now() - 1; }); return this.alarm(); }
      land() { this.edit(r => { const d = r.session.activeDraw; const end = Math.max(...d.spins.map(s => Date.parse(s.startAt) + s.durationMs)); const shift = end - Date.now() + 1000; const move = t => new Date(Date.parse(t) - shift).toISOString(); d.startAt = move(d.startAt); for (const s of d.spins) s.startAt = move(s.startAt); }); }
    }
    export class TestChannel extends ChannelWheel {
      stored() { if (!this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = 'binding'").toArray().length) return null; return this.ctx.storage.sql.exec('SELECT value FROM binding WHERE singleton = 1').toArray()[0]?.value ?? null; }
      pointed() { return this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = 'pointer'").toArray().length > 0; }
      async finishRound() { const b = JSON.parse(this.stored()); b.round.endsAt = Date.now() - 1; this.ctx.storage.sql.exec('UPDATE binding SET value = ? WHERE singleton = 1', JSON.stringify(b)); return this.alarm(); }
      staleRound() { const b = JSON.parse(this.stored()); b.round.startAt = Date.now() - 3 * 60 * 1000 - 1; this.ctx.storage.sql.exec('UPDATE binding SET value = ? WHERE singleton = 1', JSON.stringify(b)); }
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
              CREATION_LIMIT: { namespace_id: "30", simple: { limit: 100, period: 60 } },
              CREATION_GLOBAL: { namespace_id: "31", simple: { limit: 100, period: 60 } },
              REQUEST_LIMIT: { namespace_id: "32", simple: { limit: 500, period: 60 } },
            },
            outboundService: async (req: Request) => {
              const url = new URL(req.url);
              assert.equal(url.origin, "https://slack.com");
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
                    sub: "U00000007",
                    "https://slack.com/team_id": "T00000001",
                  })}.c2ln`,
                });
              }
              if (path === "auth.revoke") return Response.json({ ok: true });
              assert.equal(req.headers.get("authorization"), "Bearer synthetic-coffee-credential");
              if (path === "auth.test")
                return Response.json({ ok: true, team_id: "T00000001", user_id: "UBOT00001" });
              if (path === "users.info") {
                const id = url.searchParams.get("user")!;
                userLookups.push(id);
                return Response.json({
                  ok: true,
                  user: { id, team_id: "T00000001", deleted: false, is_bot: false, profile: { display_name: id === "U00000001" ? "Alice" : "Bob" } },
                });
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
                      { name: "coffee", count: reactors.length, users: reactors },
                      // Only water rounds count these; coffee rounds ignore them.
                      { name: "droplet", count: drinkers.length, users: drinkers },
                      // Only Koekrad rounds count these.
                      { name: "cookie", count: bakers.length, users: bakers },
                      { name: "alice-koek", count: 1, users: ["U00000002"] },
                    ],
                  },
                });
              if (path === "chat.update") {
                const body = (await req.json()) as Record<string, unknown>;
                updates.push(body);
                if (updateMode === "reject") return Response.json({ ok: false, error: "message_not_found" });
                return Response.json({ ok: true, channel: body.channel, ts: body.ts });
              }
              assert.equal(path, "chat.postMessage");
              const body = (await req.json()) as Record<string, unknown>;
              posts.push(body);
              if (postMode === "reject")
                return Response.json({ ok: false, error: "not_in_channel" });
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
          Origin: "http://127.0.0.1:5173",
          Authorization: `Bearer ${cap}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const status = async (cap: string, body?: object) => {
      const response = await api(cap, body);
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()) as ChannelCommandResult;
    };
    const navigate = (path: string, cookie?: string) =>
      mf.dispatchFetch(`http://localhost${path}`, {
        redirect: "manual",
        headers: cookie ? { Cookie: cookie } : {},
      });
    const bind = async (channel = "C00000001") => {
      const begin = await navigate(`/auth/slack/channel/${channel}`);
      assert.equal(begin.status, 303);
      const authorize = new URL(begin.headers.get("location")!);
      assert.equal(authorize.searchParams.get("client_id"), clientId);
      nonce = authorize.searchParams.get("nonce")!;
      return navigate(
        `/auth/slack/callback?code=synthetic-code&state=${authorize.searchParams.get("state")}`,
        begin.headers.get("set-cookie")!.split(";")[0],
      );
    };
    const slash = (fields: Record<string, string>, headers?: Record<string, string>) => {
      const body = slashBody(fields);
      return mf.dispatchFetch("http://localhost/slack/commands", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          ...(headers ?? sign(body)),
        },
        body,
      });
    };
    try {
      // Not a member of the channel: nothing is stored, a clear reason is shown.
      postMode = "reject";
      const refused = await bind();
      assert.equal(refused.headers.get("location"), "http://127.0.0.1:5173/#/koffie-koppelen/not_in_channel");
      postMode = "success";
      const bound = await bind();
      assert.equal(bound.headers.get("referrer-policy"), "no-referrer");
      const landing = /^http:\/\/127\.0\.0\.1:5173\/#\/koffie-beheer\/([a-f0-9]{32}\.[a-f0-9]{64})\/([a-f0-9]{32}\.[a-f0-9]{64})$/.exec(
        bound.headers.get("location")!,
      );
      assert.ok(landing);
      const [, admin, requester] = landing;
      // The confirmation proves membership and carries only the request link.
      const confirmation = posts.at(-1)!;
      assert.equal(confirmation.channel, "C00000001");
      assert.ok(JSON.stringify(confirmation).includes(`#/koffie/${requester}`));
      assert.ok(!JSON.stringify(confirmation).includes(admin.split(".")[1]));

      const namespace = await mf.getDurableObjectNamespace("CHANNELS");
      const channel = namespace.get(namespace.idFromName(admin.split(".")[0])) as unknown as {
        stored(): Promise<string | null>;
        finishRound(): Promise<void>;
        staleRound(): Promise<void>;
      };
      const stored = (await channel.stored())!;
      // The admin secret and the binder are never stored. The request link is
      // (it is already public in the channel) so every call can link to it.
      for (const secret of [admin.split(".")[1], "U00000007"])
        assert.ok(!stored.includes(secret));

      const initial = ((await status(requester)) as { status: Record<string, unknown> }).status;
      const watcher = String(initial.viewerCapability);
      assert.match(watcher, /^[a-z]{2,8}(?:-[a-z]{2,8}){4}$/);
      assert.deepEqual(
        { ...initial, expiresAt: undefined, viewerCapability: undefined },
        { role: "requester", variant: "coffee", defaultMinutes: 5, roundsLeft: 25, expiresAt: undefined, viewerCapability: undefined, reviews: { enabled: true, minutes: 15 } },
      );
      // The confirmation carries only the request link, not the word link.
      assert.ok(!JSON.stringify(posts).includes(watcher));
      // It only watches: no round yet, no settings, no commands of any kind.
      assert.deepEqual(await status(watcher), { type: "view", variant: "coffee" });
      for (const command of [{ type: "requestRound", minutes: 5 }, { type: "unbind" }, { type: "rotateRequestLink" }])
        assert.equal((await api(watcher, command)).status, 405);
      assert.ok(Date.parse(String(initial.expiresAt)) > Date.now() + 89 * 24 * 3600000);
      // Requesters cannot manage; unknown links, shapes and hosts are refused.
      for (const command of [{ type: "unbind" }, { type: "rotateRequestLink" }, { type: "setDefaultMinutes", minutes: 3 }])
        assert.equal((await api(requester, command)).status, 403);
      for (const command of [{ type: "setDefaultMinutes", minutes: 3, extra: 1 }, { type: "drop" }])
        assert.equal((await api(requester, command)).status, 400, JSON.stringify(command));
      // Rounds start only from a signed slash command: no link can request one.
      for (const link of [requester, admin])
        for (const command of [{ type: "requestRound", minutes: 5 }, { type: "requestRound", minutes: 5, variant: "water", reviews: true }])
          assert.equal((await api(link, command)).status, 400);
      assert.equal((await api(`${admin.split(".")[0]}.${randomHex()}`)).status, 404);
      assert.equal((await api("one-two-three-four-five")).status, 404);
      // Reviews are on by default; this suite covers rounds without them
      // (reviews-live.test.ts covers the rest).
      await status(admin, { type: "setReviews", enabled: false, minutes: 15 });

      // A round from /koffierad (the default wait): one call message, a prefilled ☕, a viewer-only session.
      const before = posts.length;
      assert.equal((await slash({})).status, 200);
      const started = (await status(requester)) as { status: { round: { startAt: string; spectatorCapability: string; active: boolean } } };
      const round = started.status.round;
      assert.ok(round);
      assert.equal(posts.length, before + 1);
      const call = posts.at(-1)!;
      assert.equal(call.channel, "C00000001");
      assert.equal(call.thread_ts, undefined);
      // "Kijk live mee" links to the view-only word link (requested by the owner):
      // never the request link, never a per-round link.
      assert.ok(JSON.stringify(call.blocks).includes(`"url":"http://127.0.0.1:5173/#/koffie/${watcher}"`));
      assert.ok(!JSON.stringify(call).includes(requester.split(".")[1]));
      assert.ok(!JSON.stringify(call).includes(round.spectatorCapability));
      assert.equal(round.active, true);
      // Requests without a variant stay coffee, as before water existed.
      assert.equal((round as { variant?: string }).variant, "coffee");
      // The word link sees the same round and nothing more.
      assert.deepEqual(await status(watcher), { type: "view", variant: "coffee", round });
      // No DTO ever returns the stored request link.
      assert.ok(!JSON.stringify(started).includes(requester.split(".")[1]));
      assert.ok(!JSON.stringify(await status(admin)).includes(requester.split(".")[1]));
      assert.equal(reactionsAdded.length, 1);
      assert.equal(reactionsAdded[0].name, "coffee");
      const callTs = reactionsAdded[0].timestamp as string;
      // On a whole minute, so the shown HH:mm is the real start.
      const wait = Date.parse(round.startAt) - Date.now();
      assert.equal(Date.parse(round.startAt) % 60000, 0);
      assert.ok(wait > 5 * 60000 - 5000 && wait <= 6 * 60000, String(wait));

      // One round at a time.
      const busy = (await (await slash({ text: "3" })).json()) as { response_type: string; text: string };
      assert.equal(busy.response_type, "ephemeral");
      assert.match(busy.text, /loopt al een koffieronde/);
      assert.equal(posts.length, before + 1);

      // Spectators see one wheel-to-be, the plan and no Slack details or host.
      const viewer = round.spectatorCapability;
      const snapshot = async () => {
        const r = await mf.dispatchFetch("http://localhost/api/session", {
          headers: { Origin: "http://127.0.0.1:5173", Authorization: `Bearer ${viewer}` },
        });
        assert.equal(r.status, 200);
        return ((await r.json()) as { session: PublicBeerWheelSession; role: string });
      };
      const first = await snapshot();
      assert.equal(first.role, "spectator");
      assert.equal(first.session.variant, "coffee");
      assert.equal(first.session.scheduledDraw?.startAt, round.startAt);
      assert.equal(first.session.slack, undefined);
      const sessions = await mf.getDurableObjectNamespace("SESSIONS");
      const session = sessions.get(sessions.idFromName(await wordLocator(viewer))) as unknown as {
        stored(): Promise<string>;
        due(): Promise<void>;
        postNow(): Promise<void>;
        land(): Promise<void>;
      };
      // The final check reads ☕ reactions; the bot's own never counts or is looked up.
      await session.due();
      const drawn = await snapshot();
      assert.equal(drawn.session.participants.length, 2);
      assert.equal(drawn.session.winnerCount, 1);
      assert.equal(drawn.session.activeDraw?.spins.length, 1);
      assert.ok(!userLookups.includes("UBOT00001"));
      assert.ok(!JSON.stringify(drawn).includes("U0000000"));
      await session.postNow();
      const result = posts.at(-1)!;
      assert.equal(result.thread_ts, callTs);
      // The winner stays in the thread; the channel sees it in the updated call.
      assert.equal(result.reply_broadcast, false);
      assert.match(String(result.text), /Jij mag koffie halen!/);
      const winner = /"user_id":"(U0000000[12])"/.exec(JSON.stringify(result.blocks))![1];
      assert.equal(updates.length, 1);
      const settled = updates[0];
      assert.equal(settled.channel, "C00000001");
      assert.equal(settled.ts, callTs);
      assert.equal(settled.thread_ts, undefined);
      assert.ok(JSON.stringify(settled.blocks).includes(`"user_id":"${winner}"`));
      assert.ok(JSON.stringify(settled.blocks).includes('"text":"2 deden mee"'));
      // The rewritten call carries no link or capability any more.
      assert.ok(!JSON.stringify(settled).includes(watcher));
      assert.ok(!JSON.stringify(settled).includes("http"));
      assert.match(await session.stored(), /"card":\{[^}]*"status":"updated"/);

      // While the wheel still spins, the round keeps blocking the next one.
      assert.match(((await (await slash({ text: "2" })).json()) as { text: string }).text, /loopt al een koffieronde/);
      // Once it has stopped, a new round can start right away, well before the watch window ends.
      await session.land();
      // The fixed page keeps showing the result, but the round no longer blocks.
      const landed = ((await status(requester)) as { status: { round?: { active: boolean; spectatorCapability: string } } }).status.round;
      assert.equal(landed?.active, false);
      assert.equal(landed?.spectatorCapability, viewer);
      // Success is silent: an empty 200 shows nothing; the call itself confirms.
      assert.equal(((await status(requester)) as { status: { channelName?: string } }).status.channelName, undefined);
      const reply = await slash({ text: "2", channel_name: "koffiehoek" });
      assert.equal(reply.status, 200);
      assert.equal(await reply.text(), "");
      // Slack's signed channel name is now shown to link holders and the word link.
      assert.equal(((await status(requester)) as { status: { channelName?: string } }).status.channelName, "koffiehoek");
      assert.equal(((await status(watcher)) as { channelName?: string }).channelName, "koffiehoek");
      assert.equal(posts.at(-1)!.channel, "C00000001");
      assert.equal(reactionsAdded.length, 2);
      // The new round replaced the old raw spectator link; after its window the next one is wiped too.
      assert.ok(!(await channel.stored())!.includes(viewer));
      assert.equal(((await status(requester)) as { status: { round?: { active: boolean } } }).status.round?.active, true);
      // Its result stays watchable for half an hour after the start.
      const watched = JSON.parse((await channel.stored())!).round;
      assert.equal(watched.endsAt - watched.startAt, 30 * 60 * 1000);
      // A round that never settles stops blocking three minutes after its start, yet stays shown.
      await channel.staleRound();
      assert.equal(((await status(requester)) as { status: { round?: { active: boolean } } }).status.round?.active, false);
      await channel.finishRound();
      assert.ok(!(await channel.stored())!.includes('"round"'));
      assert.equal(((await status(requester)) as { status: { round?: object } }).status.round, undefined);

      // Water: /waterrad on the same binding, a 💧 call, only :droplet: counts.
      const watered = await slash({ command: "/waterrad", text: "2" });
      assert.equal(watered.status, 200);
      assert.equal(await watered.text(), "");
      const waterCall = posts.at(-1)!;
      assert.match(String(waterCall.text), /^💧 Waterronde om \d\d:\d\d\n/);
      assert.ok(JSON.stringify(waterCall.blocks).includes(`#/koffie/${watcher}`));
      assert.equal(reactionsAdded.at(-1)!.name, "droplet");
      const waterStatus = ((await status(requester)) as { status: { variant: string; round: { variant: string; spectatorCapability: string; active: boolean } } }).status;
      assert.equal(waterStatus.variant, "water");
      assert.equal(waterStatus.round.variant, "water");
      assert.equal(((await status(watcher)) as { variant?: string }).variant, "water");
      // One round at a time per channel, whatever it fetches; the reply names the running one.
      const waterBusy = (await (await slash({ text: "3" })).json()) as { text: string };
      assert.match(waterBusy.text, /^💧 Er loopt al een waterronde/);
      const waterViewer = waterStatus.round.spectatorCapability;
      const waterSession = sessions.get(sessions.idFromName(await wordLocator(waterViewer))) as unknown as {
        due(): Promise<void>;
        postNow(): Promise<void>;
        land(): Promise<void>;
      };
      const waterSnapshot = async () => {
        const r = await mf.dispatchFetch("http://localhost/api/session", {
          headers: { Origin: "http://127.0.0.1:5173", Authorization: `Bearer ${waterViewer}` },
        });
        return ((await r.json()) as { session: PublicBeerWheelSession }).session;
      };
      assert.equal((await waterSnapshot()).variant, "water");
      await waterSession.due();
      // Only the 💧 drinker joins; ☕ reactors and the bot never do.
      assert.deepEqual((await waterSnapshot()).participants.map((p) => p.name), ["Bob"]);
      // A rejected update is tried again, never more than three times in total.
      updateMode = "reject";
      await waterSession.postNow();
      const waterResult = posts.at(-1)!;
      assert.equal(waterResult.reply_broadcast, false);
      assert.equal(updates.length, 2);
      updateMode = "success";
      await waterSession.postNow();
      assert.equal(updates.length, 3);
      assert.match(String(updates[2].text), /^💧 Waterronde om \d\d:\d\d\n🏆 Bob haalt water$/);
      await waterSession.postNow();
      assert.equal(updates.length, 3);
      assert.match(String(waterResult.text), /^💧 .*Jij mag water halen!/s);
      assert.ok(JSON.stringify(waterResult.blocks).includes('"user_id":"U00000003"'));
      await waterSession.land();
      await channel.finishRound();
      // Idle again: the screen keeps the water theme until the next round.
      const idle = ((await status(requester)) as { status: { variant: string; round?: object; roundsLeft: number } }).status;
      assert.equal(idle.round, undefined);
      assert.equal(idle.variant, "water");
      assert.equal(idle.roundsLeft, 22);

      // Koekrad: /koekrad with a word on the same binding; the word names the round, only :cookie: counts.
      const baked = await slash({ command: "/koekrad", text: "Taart 2" });
      assert.equal(baked.status, 200);
      assert.equal(await baked.text(), "");
      const cookieCall = posts.at(-1)!;
      assert.match(String(cookieCall.text), /^🍪 Taartronde om \d\d:\d\d\nKlik op 🍪 hieronder/);
      assert.ok(JSON.stringify(cookieCall.blocks).includes("Het Taartrad kiest één taarthaler."));
      assert.equal(cookieCall.mrkdwn, false);
      assert.equal(reactionsAdded.at(-1)!.name, "cookie");
      const cookieStatus = ((await status(requester)) as { status: { variant: string; round: { variant: string; title?: string; spectatorCapability: string } } }).status;
      assert.equal(cookieStatus.variant, "cookie");
      assert.equal(cookieStatus.round.variant, "cookie");
      assert.equal(cookieStatus.round.title, "taart");
      assert.equal(((await status(watcher)) as { round?: { title?: string } }).round?.title, "taart");
      // A busy channel names the running round by its word.
      const cookieBusy = (await (await slash({ command: "/waterrad" })).json()) as { text: string };
      assert.match(cookieBusy.text, /^🍪 Er loopt al een taartronde/);
      const cookieViewer = cookieStatus.round.spectatorCapability;
      const cookieSession = sessions.get(sessions.idFromName(await wordLocator(cookieViewer))) as unknown as {
        due(): Promise<void>;
        postNow(): Promise<void>;
        land(): Promise<void>;
      };
      const cookieSnapshot = async () => {
        const r = await mf.dispatchFetch("http://localhost/api/session", {
          headers: { Origin: "http://127.0.0.1:5173", Authorization: `Bearer ${cookieViewer}` },
        });
        return ((await r.json()) as { session: PublicBeerWheelSession }).session;
      };
      assert.equal((await cookieSnapshot()).variant, "cookie");
      assert.equal((await cookieSnapshot()).title, "taart");
      await cookieSession.due();
      // Only the 🍪 reactor joins; the nomination makes Alice's slice twice as
      // big. The sponsor's coffee signup does not count, and the bot never joins.
      const cookieDraw = await cookieSnapshot();
      assert.deepEqual(cookieDraw.participants, [{ id: cookieDraw.participants[0].id, name: "Alice", weight: 2 }]);
      assert.deepEqual(cookieDraw.activeDraw!.weights, [2]);
      assert.ok(!JSON.stringify(cookieDraw).includes("U0000000"));
      await cookieSession.postNow();
      await cookieSession.postNow();
      assert.match(String(updates.at(-1)!.text), /^🍪 Taartronde om \d\d:\d\d\n🏆 Alice haalt taart$/);
      assert.ok(JSON.stringify(updates.at(-1)!.blocks).includes('"user_id":"U00000001"'));
      const cookieResult = posts.findLast((p) => p.thread_ts === cookieCall.ts || String(p.text).includes("Jij mag taart halen!"))!;
      assert.match(String(cookieResult.text), /^🍪 .*Jij mag taart halen!/s);
      assert.ok(String(cookieResult.text).includes("<@U00000001>"));
      // Credit only when the nomination's ticket won: one in two here.
      const credits = String(cookieResult.text).match(/Mede mogelijk gemaakt door\.\.\. <@(U\w+)>/g) ?? [];
      assert.ok(credits.length <= 1);
      assert.ok(credits.every((c) => c.endsWith("<@U00000002>")));
      await cookieSession.land();
      await channel.finishRound();
      // The word goes with the round; an idle screen keeps the plain Koekrad theme.
      assert.ok(!(await channel.stored())!.includes("taart"));
      const cookieIdle = ((await status(requester)) as { status: { variant: string; round?: object; roundsLeft: number } }).status;
      assert.equal(cookieIdle.round, undefined);
      assert.equal(cookieIdle.variant, "cookie");
      assert.equal(cookieIdle.roundsLeft, 21);

      // Forged, stale or unknown slash commands do nothing.
      const count = posts.length;
      assert.equal((await slash({}, { "X-Slack-Request-Timestamp": String(Math.floor(Date.now() / 1000)), "X-Slack-Signature": `v0=${"0".repeat(64)}` })).status, 401);
      assert.equal((await slash({}, sign(slashBody({}), Math.floor(Date.now() / 1000) - 600))).status, 401);
      const unbound = (await (await slash({ channel_id: "C00000009" })).json()) as { text: string };
      assert.match(unbound.text, /nog geen Koffierad/);
      assert.equal(posts.length, count);

      // Admin: default minutes, rotation invalidates the old request link, unbind removes everything.
      assert.equal(((await status(admin, { type: "setDefaultMinutes", minutes: 10 })) as { status: { defaultMinutes: number } }).status.defaultMinutes, 10);
      const rotated = (await status(admin, { type: "rotateRequestLink" })) as { requestCapability: string };
      assert.equal((await api(requester)).status, 404);
      assert.equal(((await status(rotated.requestCapability)) as { status: { role: string } }).status.role, "requester");
      // Rotation also replaces the word link; the old one stops working.
      const newWatcher = ((await status(rotated.requestCapability)) as { status: { viewerCapability: string } }).status.viewerCapability;
      assert.notEqual(newWatcher, watcher);
      assert.equal((await api(watcher)).status, 404);
      assert.equal(((await status(newWatcher)) as { type: string }).type, "view");
      const pointer = async (words: string) =>
        (namespace.get(namespace.idFromName((await hashSecret(`koffierad-viewer:${words}`)).slice(0, 32))) as unknown as { pointed(): Promise<boolean> }).pointed();
      assert.equal(await pointer(watcher), false);
      assert.equal(await pointer(newWatcher), true);
      assert.ok(!(await channel.stored())!.includes(watcher));
      // Later calls link to the new fixed page.
      assert.ok((await channel.stored())!.includes(rotated.requestCapability));
      assert.ok(!(await channel.stored())!.includes(requester));
      assert.deepEqual(await status(admin, { type: "unbind" }), { type: "unbound" });
      assert.equal((await api(admin)).status, 404);
      assert.equal((await api(rotated.requestCapability)).status, 404);
      assert.equal((await api(newWatcher)).status, 404);
      assert.equal(await pointer(newWatcher), false);
      assert.equal(await channel.stored(), null);
    } finally {
      await mf.dispose();
    }
  },
);
