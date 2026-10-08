/**
 * Local demo of a channel coffee round with a fake Slack, for looking at the
 * flow end to end: the Slack call, Sign in with Slack, a 10 s countdown and
 * the review ballot. Development only: the real worker bundle runs in
 * Miniflare, in memory, on 127.0.0.1, with synthetic credentials and six
 * made-up colleagues. Nothing here reaches Slack, Cloudflare or production.
 *
 *   npm run demo   →   open http://127.0.0.1:8787/__demo/
 */
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { wordLocator } from "../worker/auth";
import type { ChannelStatus } from "../shared/channel";

const API = "http://127.0.0.1:8787";
const FRONTEND = "http://127.0.0.1:5173";
const CLIENT_ID = "1000000000.2000000000";
const TEAM = "T0DEMO001";
const CHANNEL = "C0DEMO0001";
const BOT = "UBOT00001";
const ADMIN = "U0DEMO099";
const COUNTDOWN_MS = 10000;
const SIGNING_SECRET = "synthetic-signing-secret";
const PEOPLE: Record<string, string> = {
  U0DEMO001: "Anouk",
  U0DEMO002: "Bram",
  U0DEMO003: "Fleur",
  U0DEMO004: "Joris",
  U0DEMO005: "Lotte",
  U0DEMO006: "Sem",
};
const NAMES: Record<string, string> = { ...PEOPLE, [ADMIN]: "Demo-beheerder", [BOT]: "Koffierad" };
const REVIEWS = [
  "Perfecte crema, net als in Napels.",
  "Melk was op, maar de glimlach maakte veel goed.",
  "Snel, heet en precies goed.",
  "",
  "Koffie met liefde gezet ☕",
];

interface Message {
  ts: string;
  thread?: string;
  text: string;
  blocks?: unknown[];
  edited?: boolean;
  reactions?: { name: string; users: string[] };
}
const messages: Message[] = [];
let ts = 1700000000000000;
/** Who reacts with ☕ on each call, and from when: the wheel fills up. */
const joins = new Map<string, number>();
/** Personas you logged in as in the browser; the demo never logs them in itself. */
const yours = new Set<string>();
let requester = "";
let admin = "";
let autoCountdown = true;
/** Whether the edge had to stand in for a login form's "Origin: null". */
let originBug = false;
const log = (line: string) => console.log(`[demo] ${line}`);

const script = await readFile("worker-dist/index.js", "utf8").catch(() => {
  throw new Error("worker-dist/index.js ontbreekt: start via `npm run demo`.");
});

/** Dev-only hooks to move time; appended to the in-memory bundle, never shipped. */
const hooks = `
export class DemoSession extends LiveSession {
  demoEdit(fn) {
    const record = this.read();
    if (!record) return;
    fn(record);
    record.revision++;
    this.save(record);
    this.broadcast(record);
  }
  async demoStartAt(startAt) {
    // A real round refreshes the ☕ reactions for minutes; the demo has one chance.
    const before = this.read();
    if (before?.slack?.source) {
      delete before.slack.nextImportAt;
      this.save(before);
      await this.importSlack(before).catch(() => {});
    }
    this.demoEdit((r) => {
      if (r.scheduledDraw && !["skipped", "refreshing"].includes(r.scheduledDraw.status))
        r.scheduledDraw.startAt = new Date(startAt).toISOString();
    });
    return this.alarm();
  }
  async demoOpenVoting() {
    this.demoEdit((r) => {
      if (!r.review?.opensAt || r.review.opensAt <= Date.now()) return;
      const shift = r.review.opensAt - Date.now();
      r.review.opensAt -= shift;
      r.review.closesAt -= shift;
    });
    return this.alarm();
  }
  async demoCloseVoting() {
    this.demoEdit((r) => {
      if (r.review?.closesAt) {
        r.review.opensAt = Math.min(r.review.opensAt, Date.now() - 1000);
        r.review.closesAt = Date.now();
      }
    });
    return this.alarm();
  }
  demoInfo() {
    const r = this.read();
    return r && { state: r.session.state, startAt: r.scheduledDraw?.startAt, review: r.review && { status: r.review.status, opensAt: r.review.opensAt, closesAt: r.review.closesAt } };
  }
}
export class DemoChannel extends ChannelWheel {
  async demoStartAt(startAt) {
    const binding = this.read();
    if (!binding?.round) return false;
    binding.round.startAt = startAt;
    binding.round.endsAt = startAt + 3 * 60 * 1000;
    this.save(binding);
    await this.arm(binding);
    return true;
  }
}`;

/** The browser goes to slack.com to sign in; here it goes to a fake login page. */
const edge = `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/") return Response.redirect(url.origin + "/__demo/", 302);
    if (url.pathname.startsWith("/__demo")) return env.DEMO.fetch(request);
    // Known bug, shown on the panel once seen: under the page's no-referrer policy the
    // browser sends "Origin: null" with the login form, which the worker refuses.
    let forwarded = request;
    if (url.pathname === "/auth/slack/member" && request.headers.get("Origin") === "null") {
      const headers = new Headers(request.headers);
      headers.set("Origin", env.FRONTEND_ORIGIN);
      forwarded = new Request(request, { headers });
      console.log("[demo] Origin: null bij " + url.pathname + " opgevangen (bekende bug)");
      await env.DEMO.fetch(url.origin + "/__demo/origin-bug", { method: "POST" });
    }
    const response = await env.LIVE.fetch(forwarded);
    const location = response.headers.get("location");
    if (location && location.startsWith("https://slack.com/openid/connect/authorize")) {
      const headers = new Headers(response.headers);
      headers.set("location", url.origin + "/__demo/slack-login" + new URL(location).search);
      return new Response(null, { status: response.status, headers });
    }
    return response;
  },
};`;

const nextTs = () => {
  ts += 100;
  const s = String(ts);
  return `${s.slice(0, 10)}.${s.slice(10)}`;
};
const part = (v: object) => btoa(JSON.stringify(v)).replace(/=+$/, "");

/** Slack Web API, faked: just enough for binding, calls, reactions and results. */
async function slack(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const method = url.pathname.replace(/^\/api\//, "");
  const raw = req.method === "POST" ? await req.text() : "";
  const form = new URLSearchParams(raw);
  const body = (() => {
    try {
      return JSON.parse(raw) as Record<string, any>;
    } catch {
      return Object.fromEntries(form) as Record<string, any>;
    }
  })();
  switch (method) {
    case "openid.connect.token": {
      // The fake login page puts the persona and the nonce in the code.
      const [who, sub, nonce] = String(body.code ?? "").split(".");
      if (who === "you" && PEOPLE[sub]) {
        yours.add(sub);
        log(`je logt in als ${PEOPLE[sub]}`);
        if (autoCountdown) {
          autoCountdown = false;
          await startSoon().catch((e) => log(`aftellen mislukt: ${e}`));
        }
      }
      return Response.json({
        ok: true,
        access_token: "synthetic-user-credential",
        id_token: `${part({})}.${part({
          iss: "https://slack.com",
          aud: CLIENT_ID,
          exp: Math.floor(Date.now() / 1000) + 300,
          nonce,
          sub,
          "https://slack.com/team_id": TEAM,
        })}.c2ln`,
      });
    }
    case "auth.revoke":
      return Response.json({ ok: true });
    case "auth.test":
      return Response.json({ ok: true, team_id: TEAM, user_id: BOT });
    case "users.info": {
      const id = url.searchParams.get("user") ?? body.user;
      return Response.json({
        ok: true,
        user: { id, team_id: TEAM, deleted: false, is_bot: false, profile: { display_name: NAMES[id] ?? "Collega" } },
      });
    }
    case "reactions.add": {
      const message = messages.find((m) => m.ts === body.timestamp);
      if (message) {
        message.reactions = { name: body.name, users: [BOT] };
        // Six colleagues click ☕ one after another.
        Object.keys(PEOPLE).forEach((id, i) => joins.set(`${message.ts}/${id}`, Date.now() + 1500 * (i + 1)));
      }
      return Response.json({ ok: true });
    }
    case "reactions.get": {
      const message = messages.find((m) => m.ts === url.searchParams.get("timestamp"));
      const users = [BOT, ...Object.keys(PEOPLE).filter((id) => (joins.get(`${message?.ts}/${id}`) ?? Infinity) <= Date.now())];
      if (message?.reactions) message.reactions.users = users;
      return Response.json({
        ok: true,
        type: "message",
        channel: CHANNEL,
        message: { ts: message?.ts, reactions: message?.reactions ? [{ name: message.reactions.name, count: users.length, users }] : [] },
      });
    }
    case "chat.postMessage": {
      const message: Message = { ts: nextTs(), text: body.text ?? "", blocks: body.blocks, ...(body.thread_ts ? { thread: body.thread_ts } : {}) };
      messages.push(message);
      return Response.json({ ok: true, channel: body.channel, ts: message.ts });
    }
    case "chat.update": {
      const message = messages.find((m) => m.ts === body.ts);
      if (message) Object.assign(message, { text: body.text ?? message.text, blocks: body.blocks, edited: true });
      return Response.json({ ok: true, channel: body.channel, ts: body.ts });
    }
    default:
      log(`onbekende Slack-methode ${method}`);
      return Response.json({ ok: false, error: "unknown_method" });
  }
}

const mf = new Miniflare(
  convertV4MiniflareOptions({
    host: "127.0.0.1",
    port: 8787,
    workers: [
      {
        name: "edge",
        modules: true,
        script: edge,
        compatibilityDate: "2026-09-25",
        serviceBindings: { LIVE: "bierrad", DEMO: demo },
        bindings: { FRONTEND_ORIGIN: FRONTEND },
      },
      {
        name: "bierrad",
        modules: true,
        script: script + hooks,
        compatibilityDate: "2026-09-25",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: {
          SESSIONS: { className: "DemoSession", useSQLite: true },
          CHANNELS: { className: "DemoChannel", useSQLite: true },
        },
        bindings: {
          ALLOWED_ORIGINS: `${FRONTEND},http://localhost:5173`,
          FRONTEND_URL: `${FRONTEND}/`,
          // Synthetic values: only the fake Slack above ever sees them.
          COFFEE_SLACK_BOT_TOKEN: "synthetic-coffee-credential",
          COFFEE_SLACK_CLIENT_ID: CLIENT_ID,
          COFFEE_SLACK_CLIENT_SECRET: "synthetic-coffee-client-secret",
          COFFEE_SLACK_SIGNING_SECRET: SIGNING_SECRET,
        },
        ratelimits: {
          CREATION_LIMIT: { namespace_id: "90", simple: { limit: 1000, period: 60 } },
          CREATION_GLOBAL: { namespace_id: "91", simple: { limit: 1000, period: 60 } },
          REQUEST_LIMIT: { namespace_id: "92", simple: { limit: 5000, period: 60 } },
        },
        outboundService: slack,
      },
    ],
  }),
);

const go = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string; cookie?: string } = {}) =>
  mf.dispatchFetch(`${API}${path}`, {
    redirect: "manual",
    ...init,
    headers: { ...(init.cookie ? { Cookie: init.cookie } : {}), ...init.headers },
  });
/** Finishes a login the demo starts itself, as `sub`; returns the frontend location. */
async function finishLogin(start: { headers: Headers }, sub: string) {
  const login = new URL(start.headers.get("location")!, API);
  const cookie = start.headers.get("set-cookie")!.split(";")[0];
  const done = await go(
    `/auth/slack/callback?code=demo.${sub}.${login.searchParams.get("nonce")}&state=${login.searchParams.get("state")}`,
    { cookie },
  );
  return done.headers.get("location") ?? "";
}
async function channel(cap: string, command?: object) {
  const response = await go("/api/channel", {
    method: command ? "POST" : "GET",
    headers: {
      Origin: FRONTEND,
      Authorization: `Bearer ${cap}`,
      ...(command ? { "Content-Type": "application/json" } : {}),
    },
    ...(command ? { body: JSON.stringify(command) } : {}),
  });
  const data = (await response.json()) as { status?: ChannelStatus; code?: string };
  if (!response.ok) throw new Error(data.code ?? String(response.status));
  return data.status!;
}
async function round() {
  const live = (await channel(requester)).round;
  if (!live) return undefined;
  const sessions = await mf.getDurableObjectNamespace("SESSIONS", "bierrad");
  return {
    live,
    session: sessions.get(sessions.idFromName(await wordLocator(live.spectatorCapability))) as unknown as {
      demoStartAt(at: number): Promise<void>;
      demoOpenVoting(): Promise<void>;
      demoCloseVoting(): Promise<void>;
      demoInfo(): Promise<{ state: string; startAt?: string; review?: { status: string; opensAt?: number; closesAt?: number } } | undefined>;
    },
  };
}
async function startSoon() {
  const current = await round();
  if (!current?.live.active) throw new Error("er loopt geen ronde");
  const startAt = Date.now() + COUNTDOWN_MS + 1000;
  const channels = await mf.getDurableObjectNamespace("CHANNELS", "bierrad");
  const binding = channels.get(channels.idFromName(admin.split(".")[0])) as unknown as {
    demoStartAt(at: number): Promise<boolean>;
  };
  await binding.demoStartAt(startAt);
  await current.session.demoStartAt(startAt);
  log("het rad draait over 10 seconden");
}
/** Rounds start only from Slack: a signed fake `/koffierad 15`, as Slack would send it. */
async function requestRound() {
  autoCountdown = true;
  const body = new URLSearchParams({
    command: "/koffierad",
    text: "15",
    user_id: ADMIN,
    team_id: TEAM,
    channel_id: CHANNEL,
    channel_name: "koffie-demo",
  }).toString();
  const at = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", SIGNING_SECRET).update(`v0:${at}:${body}`).digest("hex");
  const response = await go("/slack/commands", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Slack-Request-Timestamp": at,
      "X-Slack-Signature": `v0=${signature}`,
    },
    body,
  });
  // Success is an empty 200; a refusal is an ephemeral reply only "you" would see.
  const reply = await response.text();
  if (!response.ok || reply) {
    const text = (() => {
      try {
        return (JSON.parse(reply) as { text?: string }).text;
      } catch {
        return undefined;
      }
    })();
    throw new Error(text ?? (reply || String(response.status)));
  }
  log("/koffierad 15 getypt; de oproep staat in het nep-Slack-kanaal");
}
/** Everyone but you (and the haler, whom the server refuses) votes. */
async function othersVote() {
  let voted = 0;
  for (const id of Object.keys(PEOPLE).filter((id) => !yours.has(id))) {
    const start = await go("/auth/slack/member", {
      method: "POST",
      headers: { Origin: FRONTEND, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ capability: requester }).toString(),
    });
    const personal = /#\/koffie\/([a-f0-9]{32}\.[a-f0-9]{64})$/.exec(await finishLogin(start, id))?.[1];
    if (!personal) continue;
    const ballot = (await channel(personal)).member?.ballot;
    if (ballot && !ballot.submitted) {
      const scores = ballot.winners.map(() => 3 + Math.floor(Math.random() * 3));
      const texts = ballot.winners.map(() => REVIEWS[Math.floor(Math.random() * REVIEWS.length)]);
      await channel(personal, { type: "review", drawId: ballot.drawId, scores, texts }).then(() => voted++, () => {});
    }
  }
  return voted;
}

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function demo(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/__demo/, "") || "/";
  if (path === "/slack-login") {
    const state = url.searchParams.get("state") ?? "";
    const nonce = url.searchParams.get("nonce") ?? "";
    const pick = (id: string) =>
      `${API}/auth/slack/callback?code=you.${id}.${encodeURIComponent(nonce)}&state=${encodeURIComponent(state)}`;
    return html(loginPage(Object.entries(PEOPLE).map(([id, name]) => ({ name, href: pick(id) })), `${API}/auth/slack/callback?error=access_denied&state=${encodeURIComponent(state)}`));
  }
  if (path === "/origin-bug" && req.method === "POST") {
    originBug = true;
    return new Response(null, { status: 204 });
  }
  if (path === "/state") {
    const current = await round().catch(() => undefined);
    return Response.json({
      messages,
      names: NAMES,
      originBug,
      you: [...yours].map((id) => PEOPLE[id]),
      round: current && { ...current.live, ...(await current.session.demoInfo()) },
    }, { headers: { "Cache-Control": "no-store" } });
  }
  if (req.method === "POST" && path.startsWith("/action/")) {
    const action = path.slice("/action/".length);
    try {
      if (action === "round") await requestRound();
      else if (action === "start") await startSoon();
      else if (action === "open") await (await round())?.session.demoOpenVoting();
      else if (action === "close") await (await round())?.session.demoCloseVoting();
      else if (action === "others") return Response.json({ ok: true, note: `${await othersVote()} collega's hebben gestemd.` });
      else return Response.json({ ok: false, note: "Onbekende actie" }, { status: 404 });
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json({ ok: false, note: String(error instanceof Error ? error.message : error) });
    }
  }
  if (path === "/") return html(panel);
  return html("Niet gevonden", 404);
}

function loginPage(people: { name: string; href: string }[], cancel: string) {
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nep-Slack · inloggen</title>
<style>body{font-family:system-ui,sans-serif;background:#f4ede4;margin:0;display:grid;place-items:center;min-height:100vh;color:#1d1c1d}
main{background:#fff;border-radius:12px;padding:28px;max-width:420px;width:calc(100% - 32px);box-shadow:0 8px 30px #0002}
h1{font-size:20px;margin:0 0 4px}.demo{background:#fff3c4;border-radius:6px;padding:6px 10px;font-size:13px;margin-bottom:16px}
a.person{display:flex;gap:12px;align-items:center;padding:10px 12px;border:1px solid #ddd;border-radius:8px;margin:8px 0;text-decoration:none;color:inherit;font-weight:600}
a.person:hover{border-color:#611f69;background:#f8f2f9}.avatar{width:32px;height:32px;border-radius:6px;background:#611f69;color:#fff;display:grid;place-items:center}
.cancel{display:block;margin-top:16px;color:#666;font-size:14px}</style></head><body><main>
<div class="demo">🧪 Demo: dit is geen echte Slack. Kies als wie je inlogt.</div>
<h1>Inloggen bij Demo-werkplek</h1><p>Koffierad wil weten wie je bent.</p>
${people.map((p) => `<a class="person" href="${esc(p.href)}"><span class="avatar">${esc(p.name[0])}</span>${esc(p.name)}</a>`).join("")}
<a class="cancel" href="${esc(cancel)}">Annuleren</a></main></body></html>`;
}

const panel = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Koffierad-demo</title>
<style>
:root{--bg:#f6f1ea;--card:#fff;--ink:#1d1c1d;--muted:#616061;--line:#e3ded6;--accent:#7b4a2a}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{padding:16px;border-bottom:1px solid var(--line);background:var(--card)}h1{margin:0;font-size:20px}header p{margin:4px 0 0;color:var(--muted);font-size:14px}
.grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;padding:16px;max-width:1200px;margin:auto}
@media(max-width:800px){.grid{grid-template-columns:1fr}}
section{background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden}
section h2{margin:0;font-size:15px;padding:10px 14px;border-bottom:1px solid var(--line);background:#fbf8f4}
.msg{display:flex;gap:10px;padding:10px 14px}.avatar{width:36px;height:36px;border-radius:6px;background:var(--accent);color:#fff;display:grid;place-items:center;flex:none}
.who{font-weight:700}.when{color:var(--muted);font-size:12px;margin-left:6px}.body{white-space:pre-wrap;line-height:1.4;overflow-wrap:anywhere}
.body a{color:#1264a3}.reaction{display:inline-block;margin-top:6px;border:1px solid #1d9bd1;background:#e8f5fa;border-radius:12px;padding:1px 8px;font-size:13px}
.thread{margin:4px 0 0 46px;border-left:2px solid var(--line);padding-left:4px}.thread .msg{padding:6px 10px}
.edited{color:var(--muted);font-size:12px}blockquote{margin:4px 0;padding:0 0 0 10px;border-left:4px solid #ddd;white-space:pre-wrap}.empty{padding:14px;color:var(--muted)}
.controls{padding:14px;display:grid;gap:10px}.controls button{font:inherit;padding:9px 12px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;text-align:left}
.controls button:hover{border-color:var(--accent)}.status{font-size:14px;line-height:1.5;padding:0 14px 14px}.status code{background:#f1ece5;padding:1px 4px;border-radius:4px}
ol{margin:0;padding:14px 14px 14px 32px;font-size:14px;line-height:1.6}#note{min-height:1.4em;color:var(--accent);font-size:14px}
</style></head><body>
<header><h1>☕ Koffierad-demo met nep-Slack</h1><p>Lokaal en in-memory: echte worker, nep-Slack, zes verzonnen collega's. Herstart wist alles.</p>
<p id="origin-bug" hidden style="background:#fff3c4;color:#5c4400;padding:6px 10px;border-radius:6px">⚠️ Bekende bug, in de demo opgevangen: de browser stuurt bij <b>Inloggen met Slack</b> <code>Origin: null</code> mee (door het no-referrer-beleid), waardoor de echte worker de login weigert.</p></header>
<div class="grid">
<section><h2># koffie-demo</h2><div id="channel"><p class="empty">Laden…</p></div></section>
<div style="display:grid;gap:16px;align-content:start">
<section><h2>Zo loop je de flow door</h2><ol>
<li>Klik in de oproep links op <b>Open de ronde</b> (de Slack-link).</li>
<li>Kies <b>Inloggen met Slack</b> en log in als een van de zes.</li>
<li>Na inloggen telt het rad <b>10 seconden</b> af en draait.</li>
<li>Stemmen opent 1 minuut na de finale (of klik <b>Open stemmen nu</b>).</li>
<li>Stem, laat de anderen stemmen en kijk hoe de reviews in de thread komen.</li></ol>
<p class="status" style="font-size:13px;color:var(--muted)">Ben je zelf de haler, dan krijg je geen stembiljet: log dan opnieuw in als iemand anders.</p></section>
<section><h2>Bediening</h2><div class="controls">
<button data-action="start">⏱️ Laat het rad over 10 s draaien</button>
<button data-action="open">⭐ Open stemmen nu (sla de minuut over)</button>
<button data-action="others">🗳️ Laat de andere deelnemers stemmen</button>
<button data-action="close">🔒 Sluit stemmen nu</button>
<button data-action="round">☕ Nieuwe koffieronde (15 min)</button>
<div id="note" role="status"></div></div><div class="status" id="status"></div></section>
</div></div>
<script>
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => "&#" + c.charCodeAt(0) + ";");
let names = {};
function inline(e) {
  if (!e || typeof e !== "object") return "";
  if (e.type === "text") { let t = esc(e.text); if (e.style && e.style.bold) t = "<b>" + t + "</b>"; if (e.style && e.style.italic) t = "<i>" + t + "</i>"; return t; }
  if (e.type === "link") return '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.text || e.url) + "</a>";
  if (e.type === "user") return "<b>@" + esc(names[e.user_id] || e.user_id) + "</b>";
  if (e.type === "emoji") return ":" + esc(e.name) + ":";
  if (e.type === "mrkdwn" || e.type === "plain_text") return esc(e.text);
  if (e.type === "rich_text_quote") return "<blockquote>" + (e.elements || []).map(inline).join("") + "</blockquote>";
  if (e.type === "rich_text_list") return (e.border ? "<blockquote>" : "") + "<ul>" + (e.elements || []).map((s) => "<li>" + (s.elements || []).map(inline).join("") + "</li>").join("") + "</ul>" + (e.border ? "</blockquote>" : "");
  return (e.elements || []).map(inline).join("") + (e.type === "rich_text_section" ? "\\n" : "") +
    (e.text ? inline(e.text) : "") + (e.fields || []).map(inline).join("\\n");
}
function render(m) {
  const who = m.thread || !m.blocks ? "Koffierad" : "Koffierad";
  const body = m.blocks && m.blocks.length ? m.blocks.map(inline).join("\\n").replace(/\\n+$/, "") : esc(m.text);
  const reaction = m.reactions ? '<div><span class="reaction">' + (m.reactions.name === "coffee" ? "☕" : m.reactions.name === "droplet" ? "💧" : ":" + esc(m.reactions.name) + ":") + " " + m.reactions.users.length + "</span></div>" : "";
  return '<div class="msg"><div class="avatar">☕</div><div><span class="who">' + who + '</span><span class="when">APP</span>' +
    '<div class="body">' + body + (m.edited ? ' <span class="edited">(bewerkt)</span>' : "") + "</div>" + reaction + "</div></div>";
}
const time = (t) => t ? new Date(t).toLocaleTimeString("nl-NL") : "–";
async function refresh() {
  const s = await fetch("state", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
  if (!s) return;
  names = s.names;
  document.getElementById("origin-bug").hidden = !s.originBug;
  const top = s.messages.filter((m) => !m.thread);
  document.getElementById("channel").innerHTML = top.length ? top.map((m) => {
    const replies = s.messages.filter((r) => r.thread === m.ts);
    return render(m) + (replies.length ? '<div class="thread">' + replies.map(render).join("") + "</div>" : "");
  }).join("") : '<p class="empty">Nog geen berichten.</p>';
  const r = s.round;
  document.getElementById("status").innerHTML =
    "Ingelogd als: <b>" + (s.you.length ? s.you.map(esc).join(", ") : "nog niemand") + "</b><br>" +
    (r ? "Ronde: <code>" + esc(r.state || "?") + "</code> · draait om " + time(r.startAt) +
      (r.review ? "<br>Stemmen: <code>" + esc(r.review.status) + "</code> · open " + time(r.review.opensAt) + " · sluit " + time(r.review.closesAt) : "")
      : "Geen lopende ronde.");
}
document.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", async () => {
  const note = document.getElementById("note");
  note.textContent = "Bezig…";
  const r = await fetch("action/" + b.dataset.action, { method: "POST" }).then((x) => x.json()).catch(() => ({ note: "Mislukt" }));
  note.textContent = r.note || (r.ok ? "Gedaan." : "Mislukt.");
  refresh();
}));
refresh();
setInterval(refresh, 1500);
</script></body></html>`;

await mf.ready;
// Bind the channel as the demo admin, then post the first coffee call.
const bind = await go(`/auth/slack/channel/${CHANNEL}`);
const bound = /#\/koffie-beheer\/([a-f0-9.]+)\/([a-f0-9.]+)$/.exec(await finishLogin(bind, ADMIN));
if (!bound) throw new Error("Koppelen van het demokanaal mislukte.");
[, admin, requester] = bound;
await requestRound();

const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
  stdio: "inherit",
  env: { ...process.env, VITE_API_URL: API },
});
log(`klaar: open ${API}/__demo/`);
const stop = async () => {
  vite.kill();
  await mf.dispose();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
