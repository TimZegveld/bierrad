import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { cleanIntro, parseBeerText } from "../channel/beer";
import { parseSlashCommand } from "../channel/slash";
import {
  beerCallBody,
  beerReminderBody,
  boundBody,
  introElements,
  settledCallBody,
} from "../channel/messages";
import { newSession, refreshInterval } from "../session";
import { amsterdamInput } from "../../src/utils/schedule";
import type { ChannelCommandResult } from "../../shared/channel";

// Wednesday 7 October 2026, 12:00 in Amsterdam (CEST).
const now = Date.parse("2026-10-07T10:00:00Z");
const at = (iso: string) => Date.parse(iso);

test("/bierrad: today at 15:45 by default; day, time and number in any order", () => {
  assert.deepEqual(parseBeerText("", now), { ok: true, startAt: at("2026-10-07T13:45:00Z") });
  assert.deepEqual(parseBeerText("16.00", now), { ok: true, startAt: at("2026-10-07T14:00:00Z") });
  assert.deepEqual(parseBeerText("16:05", now), { ok: true, startAt: at("2026-10-07T14:05:00Z") });
  assert.deepEqual(parseBeerText("morgen 3", now), {
    ok: true,
    startAt: at("2026-10-08T13:45:00Z"),
    winners: 3,
  });
  assert.deepEqual(parseBeerText("3 16.30 vrijdag", now), {
    ok: true,
    startAt: at("2026-10-09T14:30:00Z"),
    winners: 3,
  });
  // A weekday is the next one still ahead: today, or next week once passed.
  assert.equal((parseBeerText("woensdag", now) as { startAt: number }).startAt, at("2026-10-07T13:45:00Z"));
  assert.equal((parseBeerText("wo 11.00", now) as { startAt: number }).startAt, at("2026-10-14T09:00:00Z"));
  assert.equal((parseBeerText("vr", now) as { startAt: number }).startAt, at("2026-10-09T13:45:00Z"));
  // Dates in Dutch order, and the clocks going back at the end of October.
  assert.equal((parseBeerText("10-10 16.30", now) as { startAt: number }).startAt, at("2026-10-10T14:30:00Z"));
  assert.equal((parseBeerText("30/10", now) as { startAt: number }).startAt, at("2026-10-30T14:45:00Z"));
  assert.equal((parseBeerText("1-11-2026", now) as { startAt: number }).startAt, at("2026-11-01T14:45:00Z"));
});

test("/bierrad refuses the past, far plans and dates that do not exist", () => {
  assert.deepEqual(parseBeerText("11.00", now), { ok: false, reason: "past" });
  // Not even a minute ahead.
  assert.deepEqual(parseBeerText("12.00", now), { ok: false, reason: "past" });
  assert.deepEqual(parseBeerText("vandaag 9.00", now), { ok: false, reason: "past" });
  assert.deepEqual(parseBeerText("1-10", now), { ok: false, reason: "past" });
  assert.deepEqual(parseBeerText("1-1-2027", now), { ok: false, reason: "far" });
  assert.deepEqual(parseBeerText("31-2", now), { ok: false, reason: "help" });
  assert.deepEqual(parseBeerText("31-9", now), { ok: false, reason: "help" });
  assert.deepEqual(parseBeerText("x".repeat(501), now), { ok: false, reason: "intro" });
  assert.deepEqual(parseBeerText("a\nb\nc\nd\ne\nf\ng\nh\ni", now), { ok: false, reason: "intro" });
});

test("/bierrad keeps the rest as own text, cleaned and unescaped, never as arguments", () => {
  const text = (raw: string) => (parseBeerText(raw, now) as { intro?: string }).intro;
  assert.equal(text("16.00 Hallo *allemaal* :beers:"), "Hallo *allemaal* :beers:");
  // A number above ten starts the text; only the first three words can be arguments.
  assert.deepEqual(parseBeerText("11 jaar Bierrad", now), {
    ok: true,
    startAt: at("2026-10-07T13:45:00Z"),
    intro: "11 jaar Bierrad",
  });
  assert.equal(text("morgen 16.00 2 3 halers"), "3 halers");
  assert.equal(text("16.00\nRegel een\nRegel twee"), "Regel een\nRegel twee");
  // Slack sends <, > and & as entities: they become literal characters again.
  assert.equal(text("&lt;!channel&gt; &amp; &lt;@U00000002&gt;"), "<!channel> & <@U00000002>");
  // Invisible formatting and control characters go, like in review texts.
  assert.equal(cleanIntro("Proost‮!\u0007"), "Proost!");
  assert.equal(cleanIntro("   "), undefined);
  assert.equal(cleanIntro(42), undefined);
});

test("only the Bierrad endpoint accepts /bierrad, and only /bierrad", () => {
  const body = (command: string, text = "") =>
    new URLSearchParams({
      command,
      user_id: "U00000001",
      channel_id: "C00000001",
      channel_name: "vrijdag",
      text,
    }).toString();
  assert.deepEqual(parseSlashCommand(body("/bierrad"), "coffee", now), { kind: "invalid" });
  for (const other of ["/koffierad", "/waterrad", "/koekrad"])
    assert.deepEqual(parseSlashCommand(body(other), "beer", now), { kind: "invalid" });
  assert.deepEqual(parseSlashCommand(body("/bierrad", "vrijdag 16.00 3 Proost!"), "beer", now), {
    kind: "round",
    variant: "beer",
    channelId: "C00000001",
    userId: "U00000001",
    channelName: "vrijdag",
    startAt: at("2026-10-09T14:00:00Z"),
    winners: 3,
    intro: "Proost!",
  });
  assert.deepEqual(parseSlashCommand(body("/bierrad", "hulp"), "beer", now), { kind: "help", variant: "beer" });
  assert.deepEqual(parseSlashCommand(body("/bierrad", "9.00"), "beer", now), {
    kind: "refused",
    variant: "beer",
    reason: "past",
  });
  // The coffee limit of 32 characters does not hold for the own text.
  assert.equal(parseSlashCommand(body("/bierrad", "x".repeat(400)), "beer", now).kind, "round");
  assert.equal(parseSlashCommand(body("/bierrad", "x".repeat(2001)), "beer", now).kind, "invalid");
});

test("the own text becomes literal rich text: only emoji and bold, never mentions or links", () => {
  assert.deepEqual(introElements("De *Westlandse traditie* :beers: <!channel> <@U00000002> https://example.test *"), [
    { type: "text", text: "De " },
    { type: "text", text: "Westlandse traditie", style: { bold: true } },
    { type: "text", text: " " },
    { type: "emoji", name: "beers" },
    { type: "text", text: " <!channel> <@U00000002> https://example.test *" },
  ]);
  // Bold may hold emoji; our own rating stars stay text.
  assert.deepEqual(introElements("*:flag-de: Prost* :bierrad_star_5:"), [
    { type: "emoji", name: "flag-de" },
    { type: "text", text: " Prost", style: { bold: true } },
    { type: "text", text: " :bierrad_star_5:" },
  ]);
  // Skin tones stay on their emoji, also in the notification text.
  assert.deepEqual(introElements(":point_right::skin-tone-4: *Test* :point_left::skin-tone-4:"), [
    { type: "emoji", name: "point_right", skin_tone: 4 },
    { type: "text", text: " " },
    { type: "text", text: "Test", style: { bold: true } },
    { type: "text", text: " " },
    { type: "emoji", name: "point_left", skin_tone: 4 },
  ]);
  assert.ok(
    beerCallBody("C00000001", "https://app.example.test/#/bier/x", at("2026-10-07T13:45:00Z"), 1, now, ":wave::skin-tone-2: Hoi")
      .text.startsWith(":wave::skin-tone-2: Hoi\n"),
  );
});

test("the Bierrad call has the owner's fixed text, its own text on top and the round behind \"radje\"", () => {
  const link = "https://app.example.test/#/bier/x";
  const body = beerCallBody(
    "C00000001",
    link,
    at("2026-10-07T13:45:00Z"),
    2,
    now,
    "Prost *allemaal* <!here>",
  );
  const json = JSON.stringify(body);
  assert.equal(body.channel, "C00000001");
  assert.equal(body.mrkdwn, false);
  assert.equal(body.parse, "none");
  assert.equal(body.unfurl_links, false);
  assert.ok(!("thread_ts" in body));
  assert.ok(!json.includes('"type":"user"'));
  assert.ok(json.includes('{"type":"text","text":"Prost "}'));
  assert.ok(json.includes('"text":"allemaal","style":{"bold":true}'));
  assert.ok(json.includes('" <!here>"'));
  assert.ok(json.includes('{"type":"emoji","name":"spin-the-wheel"}'));
  assert.ok(json.includes('{"type":"emoji","name":"spinner"}'));
  assert.ok(json.includes(`{"type":"link","url":"${link}","text":"radje"}`));
  assert.ok(json.includes("Het bierronde radje"));
  assert.ok(json.includes("Reageer met een "));
  assert.ok(json.includes(" gaat draaien om 15:45! "));
  assert.ok(json.includes("Het Bierrad kiest 2 bierhalers."));
  // Notifications show the same text, escaped and with emoji as shortcodes.
  assert.ok(body.text.startsWith("Prost allemaal &lt;!here&gt;\n:beers: :spin-the-wheel: Het bierronde radje"));
  // Another day names it.
  assert.ok(
    JSON.stringify(beerCallBody("C00000001", link, at("2026-10-09T13:45:00Z"), 1, now)).includes(
      " gaat draaien op vrijdag 9 oktober om 15:45! ",
    ),
  );
  assert.ok(JSON.stringify(beerCallBody("C00000001", link, at("2026-10-09T13:45:00Z"), 1, now)).includes("één bierhaler"));
});

test("the reminder links to logging in and to watching, in the thread only", () => {
  const body = beerReminderBody("C00000001", "1234567890.123456", {
    login: "https://app.example.test/#/bier/a",
    view: "https://app.example.test/#/bier/aap-beer-dak-fiets-hoed",
  });
  const json = JSON.stringify(body);
  assert.equal(body.thread_ts, "1234567890.123456");
  assert.equal(body.reply_broadcast, false);
  assert.equal(body.unfurl_links, false);
  assert.ok(json.includes('"url":"https://app.example.test/#/bier/a","text":"Inloggen"'));
  assert.ok(json.includes('"text":"alleen meekijken"'));
  const watch = JSON.stringify(
    beerReminderBody("C00000001", "1234567890.123456", { view: "https://app.example.test/#/bier/v" }),
  );
  assert.ok(watch.includes('"text":"Kijk live mee"') && !watch.includes("Inloggen"));
});

test("a settled Bierrad call keeps its own text; other wheels never show one", () => {
  const outcome = {
    kind: "winner" as const,
    names: ["Alice", "Bob"],
    mentionIds: ["U00000001", "U00000002"],
    participants: 4,
  };
  const beer = JSON.stringify(
    settledCallBody("C00000001", "1.2", now, "beer", outcome, undefined, undefined, "Prost *jij*"),
  );
  assert.ok(beer.includes('"text":"jij","style":{"bold":true}'));
  assert.ok(beer.includes('{"type":"user","user_id":"U00000002"}'));
  assert.ok(beer.includes(" halen bier"));
  const coffee = JSON.stringify(
    settledCallBody("C00000001", "1.2", now, "coffee", outcome, undefined, undefined, "Prost"),
  );
  assert.ok(!coffee.includes("Prost"));
  assert.ok(JSON.stringify(boundBody("C00000001", "https://app.example.test/#/bier/x", "beer")).includes("/bierrad"));
});

test("a round planned far ahead reads its reactions less often", () => {
  const r = newSession("h", "s", now);
  const plan = (ms: number) => {
    r.scheduledDraw = { startAt: new Date(now + ms).toISOString(), status: "pending" };
    return refreshInterval(r, now);
  };
  assert.equal(plan(3 * 3600000), 15 * 60000);
  assert.equal(plan(3600000), 5 * 60000);
  assert.equal(plan(10 * 60000), 60000);
});

const signingSecret = "synthetic-bierrad-signing-secret";
const coffeeSecret = "synthetic-coffee-signing-secret";
const sign = (body: string, secret = signingSecret) => {
  const ts = Math.floor(Date.now() / 1000);
  return {
    "X-Slack-Request-Timestamp": String(ts),
    "X-Slack-Signature":
      "v0=" + createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex"),
  };
};

test(
  "Worker binds a Bierrad channel, plans /bierrad with own text and three winners, reminds and draws",
  { timeout: 60000 },
  async () => {
    const script = await readFile("worker-dist/index.js", "utf8");
    const clientId = "1000000000.3000000000";
    let nonce = "";
    let ts = 1234567890100000;
    const posts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const reactionsAdded: Record<string, unknown>[] = [];
    const reactors = ["UBOT00002", "U00000001", "U00000002", "U00000003", "U00000004"];
    const mf = new Miniflare(
      convertV4MiniflareOptions({
        workers: [
          {
            name: "beer-channel-test",
            modules: true,
            script:
              script +
              `\nexport class TestSession extends LiveSession {
      edit(fn) { const r = JSON.parse(this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value); fn(r); this.ctx.storage.sql.exec('UPDATE session SET value = ? WHERE singleton = 1', JSON.stringify(r)); }
      stored() { return this.ctx.storage.sql.exec('SELECT value FROM session WHERE singleton = 1').one().value; }
      async remindNow() { this.edit(r => { r.slack.reminder.readyAt = Date.now() - 1; }); return this.alarm(); }
      async due() { this.edit(r => { r.scheduledDraw.startAt = new Date(Date.now() + 4000).toISOString(); }); return this.alarm(); }
      async postNow() { this.edit(r => { if (r.slack.job) r.slack.job.readyAt = 0; if (r.slack.card) r.slack.card.readyAt = Date.now() - 1; }); return this.alarm(); }
      land() { this.edit(r => { const d = r.session.activeDraw; const end = Math.max(...d.spins.map(s => Date.parse(s.startAt) + s.durationMs)); const shift = end - Date.now() + 1000; const move = t => new Date(Date.parse(t) - shift).toISOString(); d.startAt = move(d.startAt); for (const s of d.spins) s.startAt = move(s.startAt); }); }
    }
    export class TestChannel extends ChannelWheel {
      stored() { if (!this.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE name = 'binding'").toArray().length) return null; return this.ctx.storage.sql.exec('SELECT value FROM binding WHERE singleton = 1').toArray()[0]?.value ?? null; }
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
              SLACK_BOT_TOKEN: "synthetic-beer-credential",
              SLACK_CLIENT_ID: clientId,
              SLACK_CLIENT_SECRET: "synthetic-beer-client-secret",
              SLACK_SIGNING_SECRET: signingSecret,
              COFFEE_SLACK_BOT_TOKEN: "synthetic-coffee-credential",
              COFFEE_SLACK_CLIENT_ID: "1000000000.2000000000",
              COFFEE_SLACK_CLIENT_SECRET: "synthetic-coffee-client-secret",
              COFFEE_SLACK_SIGNING_SECRET: coffeeSecret,
            },
            ratelimits: {
              CREATION_LIMIT: { namespace_id: "40", simple: { limit: 100, period: 60 } },
              CREATION_GLOBAL: { namespace_id: "41", simple: { limit: 100, period: 60 } },
              REQUEST_LIMIT: { namespace_id: "42", simple: { limit: 500, period: 60 } },
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
              // Everything of a Bierrad channel goes through the Bierrad app.
              assert.equal(req.headers.get("authorization"), "Bearer synthetic-beer-credential");
              if (path === "auth.test")
                return Response.json({ ok: true, team_id: "T00000001", user_id: "UBOT00002" });
              if (path === "users.info") {
                const id = url.searchParams.get("user")!;
                return Response.json({
                  ok: true,
                  user: { id, team_id: "T00000001", deleted: false, is_bot: false, profile: { display_name: `Collega ${id.slice(-1)}` } },
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
                      { name: "beers", count: reactors.length, users: reactors },
                      // Coffee reactions never count for a Bierrad round.
                      { name: "coffee", count: 1, users: ["U00000009"] },
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
    const slash = (
      path: string,
      fields: Record<string, string>,
      secret = signingSecret,
    ) => {
      const body = new URLSearchParams({
        command: "/bierrad",
        user_id: "U00000001",
        channel_id: "C00000001",
        channel_name: "vrijdagmiddag",
        text: "",
        ...fields,
      }).toString();
      return mf.dispatchFetch(`http://localhost${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...sign(body, secret) },
        body,
      });
    };
    try {
      const begin = await navigate("/auth/slack/beer-channel/C00000001");
      assert.equal(begin.status, 303);
      const authorize = new URL(begin.headers.get("location")!);
      // The Bierrad app's own login.
      assert.equal(authorize.searchParams.get("client_id"), clientId);
      assert.match(begin.headers.get("set-cookie")!, /=beer-channel-C00000001\./);
      nonce = authorize.searchParams.get("nonce")!;
      const bound = await navigate(
        `/auth/slack/callback?code=synthetic-code&state=${authorize.searchParams.get("state")}`,
        begin.headers.get("set-cookie")!.split(";")[0],
      );
      const landing = /^http:\/\/127\.0\.0\.1:5173\/#\/bier-beheer\/([a-f0-9]{32}\.[a-f0-9]{64})\/([a-f0-9]{32}\.[a-f0-9]{64})$/.exec(
        bound.headers.get("location")!,
      );
      assert.ok(landing, bound.headers.get("location")!);
      const [, admin, requester] = landing;
      assert.ok(JSON.stringify(posts.at(-1)).includes(`#/bier/${requester}`));
      assert.ok(JSON.stringify(posts.at(-1)).includes("/bierrad"));
      const initial = ((await status(requester)) as { status: Record<string, unknown> }).status;
      assert.equal(initial.app, "beer");
      assert.equal(initial.variant, "beer");
      assert.equal(initial.defaultWinners, 2);
      assert.deepEqual(initial.reviews, { enabled: true, minutes: 30 });
      const watcher = String(initial.viewerCapability);
      assert.deepEqual(await status(watcher), { type: "view", app: "beer", variant: "beer" });

      // Only the admin sets the default number of winners, 1 to 10.
      assert.equal((await api(requester, { type: "setDefaultWinners", winners: 4 })).status, 403);
      assert.equal((await api(admin, { type: "setDefaultWinners", winners: 11 })).status, 400);
      assert.equal(((await status(admin, { type: "setDefaultWinners", winners: 4 })) as { status: { defaultWinners: number } }).status.defaultWinners, 4);

      // Each endpoint checks its own app's signature and accepts only its own commands.
      assert.equal((await slash("/slack/bier-commands", {}, coffeeSecret)).status, 401);
      assert.equal((await slash("/slack/commands", {}, coffeeSecret)).status, 400);
      const coffee = await slash("/slack/commands", { command: "/koffierad" }, coffeeSecret);
      assert.match(((await coffee.json()) as { text: string }).text, /nog geen Koffierad/);
      // A time that has passed today is refused, never moved.
      const past = await slash("/slack/bier-commands", { text: "0.00" });
      assert.match(((await past.json()) as { text: string }).text, /al geweest/);
      assert.equal(posts.length, 1);

      // Tomorrow at 16:00, three winners and an own text.
      const tomorrow = amsterdamInput(Date.now() + 24 * 3600000).slice(0, 10);
      const [year, month, day] = tomorrow.split("-").map(Number);
      const own = "De *Lederhosen* zijn opgeborgen :flag-de: &lt;!channel&gt;";
      const requested = await slash("/slack/bier-commands", { text: `${day}-${month}-${year} 16.00 3 ${own}` });
      assert.equal(requested.status, 200);
      const call = posts.at(-1)!;
      const callJson = JSON.stringify(call);
      assert.equal(posts.length, 2);
      assert.equal(call.thread_ts, undefined);
      assert.ok(callJson.includes('"text":"Lederhosen","style":{"bold":true}'));
      assert.ok(callJson.includes('{"type":"emoji","name":"flag-de"}'));
      assert.ok(callJson.includes(" <!channel>"));
      assert.ok(!callJson.includes('"type":"user"'));
      // With reviews, "radje" opens the fixed channel page to log in or watch.
      assert.ok(callJson.includes(`{"type":"link","url":"http://127.0.0.1:5173/#/bier/${requester}","text":"radje"}`));
      assert.ok(callJson.includes("Het Bierrad kiest 3 bierhalers."));
      assert.equal(reactionsAdded.at(-1)!.name, "beers");
      const started = ((await status(requester)) as { status: { round: { startAt: string; spectatorCapability: string; variant: string; active: boolean } } }).status.round;
      assert.equal(started.variant, "beer");
      assert.equal(started.active, true);
      assert.equal(amsterdamInput(Date.parse(started.startAt)), `${tomorrow}T16:00`);
      // One round at a time.
      const busy = await slash("/slack/bier-commands", { text: "morgen 17.00" });
      assert.match(((await busy.json()) as { text: string }).text, /Er loopt al een bierronde/);

      const sessions = await mf.getDurableObjectNamespace("SESSIONS");
      const { wordLocator } = await import("../auth");
      const session = sessions.get(sessions.idFromName(await wordLocator(started.spectatorCapability))) as unknown as {
        stored(): Promise<string>;
        remindNow(): Promise<void>;
        due(): Promise<void>;
        land(): Promise<void>;
        postNow(): Promise<void>;
      };
      const record = JSON.parse(await session.stored());
      assert.equal(record.preferredCount, 3);
      assert.equal(record.intro, "De *Lederhosen* zijn opgeborgen :flag-de: <!channel>");
      assert.equal(record.slack.reminder.status, "pending");
      assert.equal(record.slack.reminder.readyAt, Date.parse(started.startAt) - 120000);
      // The own text never reaches a browser.
      const spectator = await mf.dispatchFetch("http://localhost/api/session", {
        headers: { Origin: "http://127.0.0.1:5173", Authorization: `Bearer ${started.spectatorCapability}` },
      });
      assert.ok(!(await spectator.text()).includes("Lederhosen"));

      // Two minutes ahead: the links to log in or watch, in the call's thread.
      await session.remindNow();
      const reminder = posts.at(-1)!;
      assert.equal(posts.length, 3);
      assert.equal(reminder.thread_ts, reactionsAdded.at(-1)!.timestamp);
      assert.equal(reminder.reply_broadcast, false);
      assert.ok(JSON.stringify(reminder).includes(`"url":"http://127.0.0.1:5173/#/bier/${requester}","text":"Inloggen"`));
      assert.ok(JSON.stringify(reminder).includes(`"url":"http://127.0.0.1:5173/#/bier/${watcher}","text":"alleen meekijken"`));
      const afterReminder = JSON.parse(await session.stored());
      assert.equal(afterReminder.slack.reminder.status, "posted");
      assert.equal(afterReminder.slack.reminder.login, undefined);
      assert.equal(afterReminder.slack.reminder.view, undefined);
      // Never twice.
      await session.remindNow();
      assert.equal(posts.length, 3);

      // The draw: three unique winners from the 🍻 reactions, never the bot.
      await session.due();
      const drawn = JSON.parse(await session.stored());
      const draw = drawn.session.activeDraw;
      assert.equal(draw.spins.length, 3);
      assert.equal(new Set(draw.spins.map((s: { winnerId: string }) => s.winnerId)).size, 3);
      assert.equal(draw.participantIds.length, 4);
      await session.land();
      await session.postNow();
      const result = posts.at(-1)!;
      assert.equal(result.thread_ts, reactionsAdded.at(-1)!.timestamp);
      assert.match(String(result.text), /Jullie mogen bier halen!/);
      await session.postNow();
      const card = JSON.stringify(updates.at(-1));
      assert.ok(card.includes('"text":"Lederhosen","style":{"bold":true}'));
      assert.ok(card.includes(" halen bier"));
      assert.equal((card.match(/"type":"user"/g) ?? []).length, 3);
      assert.ok(!card.includes("UBOT00002"));
    } finally {
      await mf.dispose();
    }
  },
);
