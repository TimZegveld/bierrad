import { test } from "node:test";
import assert from "node:assert/strict";
import { SlackApiClient, SlackError } from "../slack/api";
import {
  parseSlackPermalink,
  SlackReactionParticipantSource,
} from "../slack/source";
import { reconcile, queueResult, resultBody, postResult } from "../slack/state";
import { newSession, mutate, advance, publicSession } from "../session";
import { authorizeStart, slackAllowed } from "../slack/access";
import { randomHex, hashSecret } from "../auth";
const link = "https://synthetic.slack.com/archives/C00000001/p1234567890123456";
const source = parseSlackPermalink(link);
const success = (data: object) => Response.json({ ok: true, ...data });
const person = (id: string, name: string, extra = {}) => ({
  id,
  deleted: false,
  is_bot: false,
  profile: { display_name: name },
  ...extra,
});
function client(
  handler: (url: URL, init: RequestInit) => Response | Promise<Response>,
) {
  return new SlackApiClient("synthetic-test-credential", (async (
    input,
    init,
  ) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://slack.com");
    assert.equal(init?.redirect, "manual");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer synthetic-test-credential",
    );
    return handler(url, init!);
  }) as typeof fetch);
}
test("strict permalink parser normalizes thread parents and rejects SSRF/ambiguous inputs", () => {
  assert.deepEqual(source, {
    channelId: "C00000001",
    parentMessageTs: "1234567890.123456",
    reactionName: "beers",
  });
  assert.equal(
    parseSlackPermalink(link + "?thread_ts=1234567890.000001&cid=C00000001")
      .parentMessageTs,
    "1234567890.000001",
  );
  for (const value of [
    "http://synthetic.slack.com/archives/C00000001/p1234567890123456",
    link.replace("synthetic.slack.com", "slack.com.evil.invalid"),
    link.replace("synthetic.slack.com", "127.0.0.1"),
    link.replace("synthetic.slack.com", "user:pass@synthetic.slack.com"),
    link + "#secret",
    link + "?url=https://evil.invalid",
    link + "?thread_ts=bad",
    link + "?thread_ts=",
    link + "?thread_ts=1234567890.000001&thread_ts=1234567890.000002",
    link + "?cid=C00000002",
    link.replace("/archives/", "/x/../archives/"),
    link + " ",
    link.replace("archives", "%61rchives"),
    link.slice(0, -1),
  ])
    assert.throws(() => parseSlackPermalink(value), SlackError);
});
test("complete reactors are deduplicated; humans/guests retained, bots/deleted filtered, safe name fallback", async () => {
  const users = [
    "U00000001",
    "U00000002",
    "U00000003",
    "U00000004",
    "U00000005",
    "U00000006",
    "U00000007",
    "USLACKBOT",
  ];
  const calls: string[] = [];
  const api = client((url) => {
    if (url.pathname.endsWith("reactions.get")) {
      assert.equal(url.searchParams.get("full"), "true");
      return success({
        type: "message",
        channel: source.channelId,
        message: {
          ts: source.parentMessageTs,
          reactions: [
            { name: "beers", count: users.length, users: [...users, users[0]] },
          ],
        },
      });
    }
    const id = url.searchParams.get("user")!;
    calls.push(id);
    const profiles = [
      person(users[0], "Alice"),
      person(users[1], "Alice", { is_restricted: true }),
      person(users[2], "", { profile: { display_name: "", real_name: "Bob" } }),
      person(users[3], "bot", { is_bot: true }),
      person(users[4], "gone", { deleted: true }),
      person(users[5], "", { profile: { email: "never@example.invalid" } }),
      person(users[6], "app", { is_app_user: true }),
    ];
    return success({ user: profiles.find((p) => p.id === id) });
  });
  const people = await new SlackReactionParticipantSource(api).getParticipants(
    source,
  );
  assert.deepEqual(
    people.map((p) => p.name),
    ["Alice", "Alice", "Bob", "Deelnemer"],
  );
  assert.equal(calls.length, 7);
  assert.equal(new Set(calls).size, 7);
  assert.ok(!JSON.stringify(people).includes("email"));
});
test("missing reaction is empty; incomplete or malformed Slack data fails atomically", async () => {
  const get = (message: object) =>
    new SlackReactionParticipantSource(
      client(() =>
        success({
          type: "message",
          channel: source.channelId,
          message: { ts: source.parentMessageTs, ...message },
        }),
      ),
    ).getParticipants(source);
  assert.deepEqual(await get({}), []);
  await assert.rejects(
    get({ reactions: [{ name: "beers", count: 2, users: ["U00000001"] }] }),
    (e: SlackError) => e.code === "slack_incomplete",
  );
  await assert.rejects(
    get({ reactions: [{ name: "beers", count: 1, users: ["bad"] }] }),
  );
  await assert.rejects(get({ thread_ts: "1234567890.000000" }));
  await assert.rejects(
    new SlackReactionParticipantSource(
      client(() => success({ user: {} })),
    ).getParticipants(source),
  );
});
test("Slack errors and Retry-After are sanitized; no immediate retries or token leakage", async () => {
  let calls = 0;
  const api = client(() => {
    calls++;
    return new Response("private error", {
      status: 429,
      headers: { "Retry-After": "123" },
    });
  });
  await assert.rejects(
    api.call("reactions.get", {}),
    (e: SlackError) =>
      e.code === "slack_rate_limited" &&
      e.retryAfterMs === 123000 &&
      !e.message.includes("private"),
  );
  assert.equal(calls, 1);
  await assert.rejects(
    client(() =>
      Response.json({
        ok: false,
        error: "invalid_auth",
        secret: "never-return",
      }),
    ).call("users.info", {}),
    (e: SlackError) => e.message === "slack_rejected",
  );
});
test("refresh retains opaque IDs and manual additions, distinguishes equal names and constrains count", () => {
  const now = Date.now(),
    record = newSession("host", "spectator", now);
  record.slack = { grantHash: "hash", mapping: {} };
  mutate(
    record,
    "host",
    { type: "setParticipants", revision: record.revision, names: ["Alice"] },
    now,
  );
  const people = [
    { slackId: "U00000001", name: "Alice" },
    { slackId: "U00000002", name: "Alice" },
  ];
  reconcile(record, source, people, now);
  assert.deepEqual(
    record.session.participants.map((p) => p.name),
    ["Alice", "Alice (2)", "Alice (3)"],
  );
  const ids = { ...record.slack.mapping };
  record.preferredCount = 3;
  reconcile(record, source, [people[0]], now);
  assert.equal(record.slack.mapping[people[0].slackId], ids[people[0].slackId]);
  assert.equal(record.session.participants.length, 2);
  assert.equal(record.session.winnerCount, 2);
  assert.ok(!JSON.stringify(publicSession(record)).includes("U00000001"));
  assert.ok(!JSON.stringify(publicSession(record)).includes("C00000001"));
  reconcile(record, source, [people[0], { slackId: "U00000003", name: "Charlie" }], now);
  assert.equal(record.slack.mapping[people[0].slackId], ids[people[0].slackId]);
  assert.ok(record.session.participants.some(p => p.name === "Charlie"));
  assert.equal(record.session.participants.length, 3);
  reconcile(record, source, [], now);
  assert.deepEqual(
    record.session.participants.map((p) => p.name),
    ["Alice"],
  );
});
test("start grants require secret and bot, expire and rotate; public sessions get no Slack rights", async () => {
  const token = randomHex(),
    hash = await hashSecret(token);
  const env = {
    SLACK_BOT_TOKEN: "synthetic",
    SLACK_START_GRANT: JSON.stringify({ hash, expiresAt: Date.now() + 10000 }),
  };
  assert.ok(await authorizeStart(`Bearer ${token}`, env));
  assert.equal(await authorizeStart(`Bearer ${randomHex()}`, env), undefined);
  assert.equal(
    await authorizeStart(`Bearer ${token}`, {
      ...env,
      SLACK_BOT_TOKEN: undefined,
    }),
    undefined,
  );
  assert.equal(slackAllowed(undefined, env), false);
  assert.equal(
    slackAllowed(hash, {
      ...env,
      SLACK_START_GRANT: JSON.stringify({ hash, expiresAt: 1 }),
    }),
    false,
  );
  assert.equal(
    slackAllowed(hash, {
      ...env,
      SLACK_START_GRANT: JSON.stringify({
        hash: await hashSecret(randomHex()),
        expiresAt: Date.now() + 10000,
      }),
    }),
    false,
  );
});
test("posting freezes official winners/target; thread-only safe singular/plural; failure never changes draw", async () => {
  const now = Date.now(),
    r = newSession("host", "spectator", now);
  r.slack = { grantHash: "hash", mapping: {}, source };
  mutate(
    r,
    "host",
    {
      type: "setParticipants",
      names: ["Alice", "<@everyone>"],
      revision: r.revision,
    },
    now,
  );
  mutate(r, "host", { type: "startDraw", revision: r.revision }, now);
  const job = r.slack.job!;
  assert.equal(job.drawId, r.session.activeDraw!.id);
  assert.deepEqual(
    job.names,
    r.session.activeDraw!.spins.map(
      (s) => r.session.participants.find((p) => p.id === s.winnerId)!.name,
    ),
  );
  advance(r, now + 10000);
  const official = structuredClone(r.session);
  const body = resultBody(job);
  assert.equal(body.thread_ts, source.parentMessageTs);
  assert.equal(body.reply_broadcast, false);
  assert.ok(body.text.includes("Jullie"));
  assert.ok(!body.text.includes("<@"));
  assert.equal(body.blocks[0].text.type, "plain_text");
  assert.ok(resultBody({ ...job, names: ["Alice"] }).text.includes("Jij mag"));
  const posted = await postResult(
    client((url, init) => {
      assert.equal(url.pathname, "/api/chat.postMessage");
      assert.deepEqual(JSON.parse(String(init.body)), body);
      return success({ channel: source.channelId, ts: "1234567890.999999" });
    }),
    job,
  );
  assert.equal(posted.status, "posted");
  assert.equal(
    (
      await postResult(
        client(() => Response.json({ ok: false, error: "not_in_channel" })),
        job,
      )
    ).status,
    "failed",
  );
  assert.equal(
    (
      await postResult(
        client(() => {
          throw new Error("network failure after Slack accepted");
        }),
        job,
      )
    ).status,
    "uncertain",
  );
  assert.equal(
    (
      await postResult(
        client(() => Response.json([])),
        job,
      )
    ).status,
    "uncertain",
  );
  assert.deepEqual(r.session, official);
  job.status = "uncertain";
  assert.throws(() =>
    mutate(
      r,
      "host",
      { type: "slackRetry", revision: r.revision },
      now + 10000,
    ),
  );
  assert.throws(() =>
    mutate(
      r,
      "spectator",
      { type: "slackRetry", revision: r.revision },
      now + 10000,
    ),
  );
  queueResult(r);
  assert.equal(r.slack.job!.names.length, 2);
});
