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

test("nominations enlarge only the unique exact match's slice; missing, ambiguous and withdrawn ones are ignored", () => {
  const carol = { slackId: "U00000003", name: "Carol" };
  const r = record([alice, bob, carol, nomination, { ...nomination, slackId: carol.slackId }]);
  const [aliceId, bobId] = r.session.participants.map((p) => p.id);
  assert.deepEqual(r.session.participants.map(({ name, weight }) => ({ name, weight })),
    [{ name: "Alice", weight: 3 }, { name: "Bob", weight: undefined }, { name: "Carol", weight: undefined }]);
  assert.deepEqual(r.slack!.cookieSponsors, { [aliceId]: [bob.slackId, carol.slackId] });
  assert.equal(r.slack!.count, 3);
  const dto = JSON.stringify(publicSession(r));
  assert.ok(dto.includes('"weight":3'));
  for (const privateValue of ["U0000000", "cookieSponsors", "koek"])
    assert.ok(!dto.includes(privateValue));
  // Stable IDs; a withdrawn reaction shrinks the slice again.
  reconcile(r, source, [alice, bob, carol, nomination], now);
  assert.deepEqual(r.session.participants.map((p) => [p.id, p.weight]), [[aliceId, 2], [bobId, undefined], [r.session.participants[2].id, undefined]]);
  reconcile(r, source, [alice, bob], now);
  assert.equal(r.slack!.cookieSponsors, undefined);
  assert.ok(r.session.participants.every((p) => p.weight === undefined));
  // Without a 🍪 Alice, or with two of them, the nomination is ignored.
  reconcile(r, source, [bob, nomination], now);
  assert.deepEqual(r.session.participants.map((p) => [p.name, p.weight]), [["Bob", undefined]]);
  reconcile(r, source, [alice, { ...alice, slackId: carol.slackId, name: "ALICE" }, bob, nomination], now);
  assert.ok(r.session.participants.every((p) => p.weight === undefined));
  assert.equal(r.slack!.cookieSponsors, undefined);
  reconcile(r, source, [{ ...alice, name: "aLiCe" }, bob, nomination], now);
  assert.equal(r.session.participants[0].weight, 2);
});

test("full names match before suffixes, legacy extra entries go, oversized reconciliation is atomic", () => {
  const r = record([{ ...alice, name: "Alice Bakker" }, bob,
    { ...nomination, cookieReaction: "alice_bakker-koek" }]);
  assert.deepEqual(r.session.participants.map((p) => [p.name, p.weight]), [["Alice Bakker", 2], ["Bob", undefined]]);
  // A round started before weighted slices keeps no stale extra entry.
  r.slack!.cookieEntries = { "alice-koek:U00000002": { id: "legacy" } };
  r.session = { ...r.session, participants: [...r.session.participants, { id: "legacy", name: "Alice (2)" }] };
  reconcile(r, source, [alice, bob], now);
  assert.deepEqual(r.session.participants.map((p) => p.name), ["Alice", "Bob"]);
  assert.equal(r.slack!.cookieEntries, undefined);
  const previous = structuredClone(r);
  const many = Array.from({ length: 101 }, (_, i) => ({ slackId: `U${String(i).padStart(8, "0")}`, name: `Synthetic ${i}` }));
  assert.throws(() => reconcile(r, source, many, now), { code: "slack_too_many" });
  assert.deepEqual(r, previous);
});

test("the winning ticket decides the credit; slice, mention and review stay with the signed-up winner", () => {
  const seen = new Set<string | null>();
  for (let i = 0; i < 200 && seen.size < 2; i++) {
    const r = record([alice, bob, nomination]);
    draw(r, r.slack!.mapping[alice.slackId]);
    const job = r.slack!.job!;
    assert.deepEqual(r.session.activeDraw!.weights, [2, 1]);
    assert.deepEqual(job.names, ["Alice"]);
    assert.deepEqual(job.mentionIds, [alice.slackId]);
    seen.add(job.sponsorIds![0]);
    const body = resultBody(job);
    const users = body.blocks[0].elements[0].elements.filter((e) => e.type === "user").map((e) => e.user_id);
    if (job.sponsorIds![0]) {
      assert.match(body.text, /Mede mogelijk gemaakt door\.\.\. <@U00000002>/);
      assert.deepEqual(users, [alice.slackId, bob.slackId]);
    } else {
      assert.ok(!body.text.includes("mogelijk gemaakt"));
      assert.deepEqual(users, [alice.slackId]);
    }
    assert.equal(body.reply_broadcast, false);
    assert.equal(body.unfurl_links, false);
    assert.ok(!JSON.stringify(publicSession(r)).includes("U0000000"));
  }
  // Both the own 🍪 ticket and the nomination ticket can win.
  assert.deepEqual([...seen].sort(), [bob.slackId, null].sort());

  const normal = record([alice, bob, nomination]);
  draw(normal, normal.slack!.mapping[bob.slackId]);
  assert.deepEqual(normal.slack!.job!.mentionIds, [bob.slackId]);
  assert.deepEqual(normal.slack!.job!.sponsorIds, [null]);
  const job = { ...normal.slack!.job!, sponsorIds: ["!channel"] };
  assert.ok(!resultBody(job).text.includes("<!channel>"));
  assert.ok(!resultBody({ ...job, sponsorIds: [bob.slackId], source: { ...source, reactionName: "coffee" } }).text.includes("mogelijk gemaakt"));

  const matched = record([alice, bob, nomination]);
  draw(matched, matched.slack!.mapping[alice.slackId]);
  matched.review = { minutes: 15, key: "synthetic", status: "waiting" };
  openReview(matched, new Map([[alice.slackId, "pseudo-alice"], [bob.slackId, "pseudo-bob"]]));
  assert.deepEqual(matched.review.winners!.map((w) => w.mentionId), [alice.slackId]);
  assert.deepEqual(matched.review.eligible, ["pseudo-bob"]);
  assert.equal(reviewBallot(matched, "pseudo-alice", matched.review.opensAt!), undefined);
  assert.ok(reviewBallot(matched, "pseudo-bob", matched.review.opensAt!));
});
