import { test } from "node:test";
import assert from "node:assert/strict";
import { SlackApiClient, SlackError } from "../slack/api";
import { cookieName, SlackReactionParticipantSource, type SlackPerson } from "../slack/source";
import { reconcile, queueResult, resultBody } from "../slack/state";
import { newSession, publicSession } from "../session";
import { startDraw } from "../../src/domain/drawEngine";
import { openReview, reviewBallot } from "../reviews";

const now = Date.parse("2026-10-07T12:00:00Z");
const source = { channelId: "C00000001", parentMessageTs: "1234567890.123456", reactionName: "cookie" as const };
const alice = { slackId: "U00000001", name: "Alice" };
const bob = { slackId: "U00000002", name: "Bob" };
const nomination = { slackId: bob.slackId, name: "Alice", cookieReaction: "alice-koek" };

function record(people: SlackPerson[]) {
  const r = newSession("host", "viewer", now, "cookie");
  r.preferredCount = 1;
  r.slack = { grantHash: "synthetic", mapping: {}, channelRound: true };
  reconcile(r, source, people, now);
  return r;
}
function draw(r: ReturnType<typeof record>, id: string) {
  r.session = startDraw(r.session, { id: "draw", startAt: new Date(now).toISOString() }, { forcedIds: [id] });
  queueResult(r);
}

test("cookie emoji names are bounded literal names, with underscores for spaces", () => {
  assert.equal(cookieName("alice-koek"), "Alice");
  assert.equal(cookieName("alice_bakker-koek"), "Alice bakker");
  assert.equal(cookieName("alice-bakker-koek"), "Alice-bakker");
  for (const value of [undefined, "cookie", "-koek", "a".repeat(33) + "-koek", "<@U00000001>-koek", "!channel-koek", "alice\u200b-koek", "alice__bakker-koek", "alice-koek-extra"])
    assert.equal(cookieName(value), undefined);
});

test("cookie reactions add one entry per human reactor without replacing own signups or extra emojis", async () => {
  const lookups: string[] = [];
  const reactions = [
    { name: "cookie", count: 3, users: [alice.slackId, bob.slackId, "UBOT00001"] },
    { name: "alice-koek", count: 5, users: [bob.slackId, bob.slackId, "U00000003", "UBOT00001", "U00000004", "U00000005"] },
    { name: "carol-koek", count: 1, users: [bob.slackId] },
    { name: "coffee", count: 1, users: ["U00000006"] },
    { name: "<!channel>-koek", count: 1, users: ["U00000007"] },
  ];
  const api = new SlackApiClient("synthetic", (async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("reactions.get"))
      return Response.json({ ok: true, type: "message", channel: source.channelId,
        message: { ts: source.parentMessageTs, reactions } });
    const id = url.searchParams.get("user")!;
    lookups.push(id);
    return Response.json({ ok: true, user: { id, deleted: id === "U00000004", is_bot: id === "U00000005", profile: { display_name: id === alice.slackId ? "Alice" : "Bob" } } });
  }) as typeof fetch);
  const people = await new SlackReactionParticipantSource(api).getParticipants(source, ["UBOT00001"]);
  assert.deepEqual(people.filter((p) => !p.cookieReaction), [alice, bob]);
  assert.deepEqual(people.filter((p) => p.cookieReaction), [nomination,
    { ...nomination, slackId: "U00000003" },
    { ...nomination, name: "Carol", cookieReaction: "carol-koek" }]);
  assert.equal(new Set(lookups).size, lookups.length);
  assert.ok(!lookups.includes("UBOT00001"));
  assert.ok(!lookups.includes("U00000006"));
  assert.ok(!lookups.includes("U00000007"));
  for (const reactionName of ["beers", "coffee", "droplet"] as const) {
    const imported = await new SlackReactionParticipantSource(api).getParticipants({ ...source, reactionName });
    assert.ok(imported.every((p) => !p.cookieReaction));
  }
});

test("emoji-only rounds work; incomplete, duplicate and oversized reactions fail closed", async () => {
  const get = (reactions: object[]) => new SlackReactionParticipantSource(new SlackApiClient("synthetic", (async (input) =>
    Response.json(new URL(String(input)).pathname.endsWith("reactions.get")
      ? { ok: true, type: "message", channel: source.channelId, message: { ts: source.parentMessageTs, reactions } }
      : { ok: true, user: { id: bob.slackId, profile: { display_name: "Bob" } } })) as typeof fetch)).getParticipants(source);
  const reaction = { name: "alice-koek", count: 1, users: [bob.slackId] };
  assert.deepEqual(await get([reaction]), [nomination]);
  await assert.rejects(get([{ ...reaction, count: 2 }]), (e: SlackError) => e.code === "slack_incomplete");
  await assert.rejects(get([reaction, reaction]), (e: SlackError) => e.code === "slack_response");
  await assert.rejects(get([{ ...reaction, users: ["invalid"] }]), SlackError);
  const many = Array.from({ length: 101 }, (_, i) => `U${String(i).padStart(8, "0")}`);
  await assert.rejects(get([{ ...reaction, count: many.length, users: many }]), (e: SlackError) => e.code === "slack_too_many");
});

test("refresh retains extra opaque IDs, removes withdrawn emojis and resolves only unambiguous own signups", () => {
  const r = record([alice, bob, nomination, { ...nomination, slackId: "U00000003" }]);
  assert.deepEqual(r.session.participants.map((p) => p.name), ["Alice", "Bob", "Alice (2)", "Alice (3)"]);
  assert.equal(r.slack!.mapping[bob.slackId], r.session.participants[1].id);
  const activeDto = JSON.stringify(publicSession(r));
  for (const privateValue of [alice.slackId, bob.slackId, "cookieEntries", "sponsorId"])
    assert.ok(!activeDto.includes(privateValue));
  const entries = structuredClone(r.slack!.cookieEntries!);
  reconcile(r, source, [alice, bob, nomination, { ...nomination, slackId: "U00000003" }], now);
  assert.deepEqual(r.slack!.cookieEntries, entries);
  reconcile(r, source, [bob, nomination], now);
  assert.equal(Object.values(r.slack!.cookieEntries!)[0].mentionId, null);
  assert.equal(Object.values(r.slack!.cookieEntries!)[0].id, entries["alice-koek:U00000002"].id);
  assert.deepEqual(r.session.participants.map((p) => p.name), ["Bob", "Alice"]);
  reconcile(r, source, [alice, { ...alice, slackId: "U00000003", name: "ALICE" }, bob, nomination], now);
  assert.equal(Object.values(r.slack!.cookieEntries!)[0].mentionId, null);
  reconcile(r, source, [{ ...alice, name: "aLiCe" }, bob, nomination], now);
  assert.equal(Object.values(r.slack!.cookieEntries!)[0].mentionId, alice.slackId);
  reconcile(r, source, [alice, bob], now);
  assert.deepEqual(r.slack!.cookieEntries, {});
  assert.equal(r.session.participants.length, 2);
  const dto = JSON.stringify(publicSession(r));
  for (const privateValue of [alice.slackId, bob.slackId, "cookieEntries", "sponsorId"])
    assert.ok(!dto.includes(privateValue));
});

test("extra winner freezes target and sponsor mentions, regular winners have no credit", () => {
  const r = record([alice, bob, nomination]);
  draw(r, Object.values(r.slack!.cookieEntries!)[0].id);
  const job = r.slack!.job!;
  assert.deepEqual(job.mentionIds, [alice.slackId]);
  assert.deepEqual(job.sponsorIds, [bob.slackId]);
  r.slack!.cookieEntries = {};
  r.slack!.mapping = {};
  const body = resultBody(job);
  assert.match(body.text, /<@U00000001>/);
  assert.match(body.text, /Mede mogelijk gemaakt door\.\.\. <@U00000002>/);
  assert.deepEqual(body.blocks[0].elements[0].elements.filter((e) => e.type === "user").map((e) => e.user_id), [alice.slackId, bob.slackId]);
  assert.equal(body.reply_broadcast, false);
  assert.equal(body.unfurl_links, false);
  assert.ok(!JSON.stringify(publicSession(r)).includes("U0000000"));
  const normal = record([alice, bob, nomination]);
  draw(normal, normal.slack!.mapping[bob.slackId]);
  assert.deepEqual(normal.slack!.job!.mentionIds, [bob.slackId]);
  assert.ok(!resultBody(normal.slack!.job!).text.includes("mogelijk gemaakt"));
  assert.ok(!resultBody({ ...job, sponsorIds: ["!channel"] }).text.includes("<!channel>"));
  assert.ok(!resultBody({ ...job, source: { ...source, reactionName: "coffee" } }).text.includes("mogelijk gemaakt"));
});

test("full names match before suffixes and oversized reconciliation is atomic", () => {
  const r = record([{ ...alice, name: "Alice Bakker" }, bob,
    { ...nomination, cookieReaction: "alice_bakker-koek" }]);
  assert.equal(Object.values(r.slack!.cookieEntries!)[0].mentionId, alice.slackId);
  assert.deepEqual(r.session.participants.map((p) => p.name), ["Alice Bakker", "Bob", "Alice bakker (2)"]);
  const previous = structuredClone(r);
  const many = Array.from({ length: 101 }, (_, i) => ({ slackId: `U${String(i).padStart(8, "0")}`, name: `Synthetic ${i}` }));
  assert.throws(() => reconcile(r, source, many, now), { code: "slack_too_many" });
  assert.deepEqual(r, previous);
});

test("unmatched emoji winner stays literal and reviews never grant votes through an emoji", () => {
  const r = record([nomination]);
  draw(r, r.session.participants[0].id);
  assert.deepEqual(r.slack!.job!.mentionIds, [null]);
  assert.match(resultBody(r.slack!.job!).text, /\nAlice\nJij mag koek halen!/);
  r.review = { minutes: 15, key: "synthetic", status: "waiting" };
  openReview(r, new Map());
  assert.equal(r.review.status, "closed");

  const matched = record([alice, bob, nomination]);
  draw(matched, Object.values(matched.slack!.cookieEntries!)[0].id);
  matched.review = { minutes: 15, key: "synthetic", status: "waiting" };
  openReview(matched, new Map([[alice.slackId, "pseudo-alice"], [bob.slackId, "pseudo-bob"]]));
  assert.deepEqual(matched.review.winners!.map((w) => w.mentionId), [alice.slackId]);
  assert.deepEqual(matched.review.eligible, ["pseudo-bob"]);
  assert.equal(reviewBallot(matched, "pseudo-alice", matched.review.opensAt!), undefined);
  assert.ok(reviewBallot(matched, "pseudo-bob", matched.review.opensAt!));

  const sponsorOnly = record([alice, nomination]);
  draw(sponsorOnly, Object.values(sponsorOnly.slack!.cookieEntries!)[0].id);
  sponsorOnly.review = { minutes: 15, key: "synthetic", status: "waiting" };
  openReview(sponsorOnly, new Map([[alice.slackId, "pseudo-alice"]]));
  assert.equal(sponsorOnly.review.status, "closed");
  assert.equal(reviewBallot(sponsorOnly, "pseudo-bob", now + 60000), undefined);
});
