import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ChannelApiError,
  channelRequest,
  parseChannelRoute,
} from "../sessions/ChannelClient";

const cap = `${"a".repeat(32)}.${"b".repeat(64)}`;
const other = `${"c".repeat(32)}.${"d".repeat(64)}`;

test("channel routes accept only exact fragments with hex or 5-word capabilities", () => {
  assert.deepEqual(parseChannelRoute("#/koffie-koppelen"), { app: "coffee", page: "bind" });
  assert.deepEqual(parseChannelRoute("#/koffie-koppelen/not_in_channel"), {
    app: "coffee",
    page: "bind",
    failure: "not_in_channel",
  });
  assert.deepEqual(parseChannelRoute(`#/koffie/${cap}`), {
    app: "coffee",
    page: "wheel",
    capability: cap,
  });
  // The word link only watches.
  assert.deepEqual(parseChannelRoute("#/koffie/aap-beer-dak-fiets-hoed"), {
    app: "coffee",
    page: "view",
    capability: "aap-beer-dak-fiets-hoed",
  });
  assert.deepEqual(parseChannelRoute(`#/koffie-beheer/${cap}/${other}`), {
    app: "coffee",
    page: "wheel",
    capability: cap,
    requestCapability: other,
  });
  // A failed personal login lands without any link.
  assert.deepEqual(parseChannelRoute("#/koffie-login/forbidden"), {
    app: "coffee",
    page: "memberFailure",
    failure: "forbidden",
  });
  // The Bierrad's channel pages have their own routes and app.
  assert.deepEqual(parseChannelRoute("#/bier-koppelen/busy"), {
    app: "beer",
    page: "bind",
    failure: "busy",
  });
  assert.deepEqual(parseChannelRoute(`#/bier/${cap}`), {
    app: "beer",
    page: "wheel",
    capability: cap,
  });
  assert.deepEqual(parseChannelRoute("#/bier/aap-beer-dak-fiets-hoed"), {
    app: "beer",
    page: "view",
    capability: "aap-beer-dak-fiets-hoed",
  });
  assert.deepEqual(parseChannelRoute(`#/bier-beheer/${cap}/${other}`), {
    app: "beer",
    page: "wheel",
    capability: cap,
    requestCapability: other,
  });
  assert.deepEqual(parseChannelRoute("#/bier-login/expired"), {
    app: "beer",
    page: "memberFailure",
    failure: "expired",
  });
  for (const hash of [
    "#/koffie-login",
    "#/koffie-login/not_in_channel",
    `#/koffie-login/${cap}`,
    "#/koffie-koppelen/other",
    `#/koffie/${cap}/extra`,
    "#/koffie/aap-beer-dak-fiets",
    "#/koffie/aap-beer-dak-fiets-hoed-jas",
    "#/koffie/Aap-beer-dak-fiets-hoed",
    "#/koffie-beheer/aap-beer-dak-fiets-hoed",
    `#/koffie-beheer/${cap}`,
    "#/coffee",
    "#/bier",
    "#/bierrad",
    `#/bierkoppelen`,
    `#/bier-beheer/${cap}`,
    `#/beer/${cap}`,
  ])
    assert.equal(parseChannelRoute(hash), null, hash);
});

test("channel client sends the capability only as a bearer header, never stores it", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(url), init: init! });
    return Response.json({
      type: "status",
      status: { role: "requester", defaultMinutes: 5, roundsLeft: 25, expiresAt: "2027-01-01T00:00:00.000Z" },
    });
  }) as typeof fetch;
  const result = await channelRequest("https://api.example.test", cap, { type: "setDefaultMinutes", minutes: 5 }, fetcher);
  assert.equal(result.type, "status");
  assert.equal(seen[0].url, "https://api.example.test/api/channel");
  assert.ok(!seen[0].url.includes(cap));
  assert.equal(new Headers(seen[0].init.headers).get("authorization"), `Bearer ${cap}`);
  assert.equal(seen[0].init.credentials, "omit");
  assert.equal(seen[0].init.referrerPolicy, "no-referrer");
  assert.equal(seen[0].init.body, JSON.stringify({ type: "setDefaultMinutes", minutes: 5 }));
});

test("channel errors become friendly Dutch messages without server details", async () => {
  const failing = (status: number, body: unknown) =>
    (async () => Response.json(body, { status })) as unknown as typeof fetch;
  await assert.rejects(
    channelRequest("https://api.example.test", cap, undefined, failing(409, { code: "round_active" })),
    (e: unknown) => e instanceof ChannelApiError && e.code === "round_active" && /loopt al een ronde/.test(e.message),
  );
  await assert.rejects(
    channelRequest("https://api.example.test", cap, undefined, failing(500, { stack: "secret" })),
    (e: unknown) => e instanceof ChannelApiError && !e.message.includes("secret"),
  );
});

test("login forms send their Origin: strict-origin page policy, no noreferrer on the form", () => {
  // Under no-referrer browsers send "Origin: null" with a cross-origin form
  // POST, and /auth/slack/member refuses every login.
  const page = readFileSync("index.html", "utf8");
  assert.match(page, /<meta name="referrer" content="strict-origin" \/>/);
  assert.doesNotMatch(page, /content="no-referrer"/);
  const form = /<form[\s\S]*?>/.exec(
    readFileSync("src/components/ReviewBallot.tsx", "utf8"),
  )![0];
  assert.match(form, /method="post"/);
  assert.doesNotMatch(form, /noreferrer/);
});
