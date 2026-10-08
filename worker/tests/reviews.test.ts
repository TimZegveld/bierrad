import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, startDraw } from "../../src/domain/drawEngine";
import { newSession, publicSession, type StoredSession } from "../session";
import { queueResult } from "../slack/state";
import {
  closeReview,
  openReview,
  reviewDeadline,
  reviewBallot,
  settleReviewJob,
  submitReview,
} from "../reviews";
import { reviewBody, settledCallBody } from "../channel/messages";
import { beginLogin, parseLoginCookie, LOGIN_COOKIE } from "../slack/login";
import {
  cleanReviewText,
  validSubmission,
} from "../../shared/reviews";

const now = Date.parse("2026-10-06T12:00:00Z");
const startAt = now + 300000;
const people = [
  { id: "p1", name: "Alice", slack: "U00000001" },
  { id: "p2", name: "Bob", slack: "U00000002" },
  { id: "p3", name: "Carol", slack: "U00000003" },
];
const alias = (slack: string) => `pseudo-${slack}`;

/** A drawn channel round with reviews; returns the record and its winner. */
function drawnRound(minutes = 10) {
  const r: StoredSession = newSession("host", "viewer", now, "coffee");
  r.expiresAt = startAt + 3600000;
  r.scheduledDraw = { startAt: new Date(startAt).toISOString(), status: "skipped" };
  r.slack = {
    grantHash: "slack-channel",
    mapping: Object.fromEntries(people.map((p) => [p.slack, p.id])),
    source: { channelId: "C00000001", parentMessageTs: "1234567890.123456", reactionName: "coffee" },
    channelRound: true,
  };
  r.review = { minutes, key: "ab".repeat(32), link: "https://example.test/#/koffie/x", status: "waiting" };
  r.session = startDraw(
    createSession("s1", people.map(({ id, name }) => ({ id, name })), 1),
    { id: "d1", startAt: new Date(startAt).toISOString() },
  );
  queueResult(r);
  openReview(r, new Map(people.map((p) => [p.slack, alias(p.slack)])));
  const winnerId = r.session.activeDraw!.spins[0].winnerId;
  const winner = people.find((p) => p.id === winnerId)!;
  const voters = people.filter((p) => p !== winner);
  const end = r.review.opensAt!;
  return { r, winner, voters, end };
}

test("reviews open a minute after the last reveal, for every Slack participant except the winner", () => {
  const { r, winner, voters, end } = drawnRound();
  assert.equal(r.review!.status, "open");
  assert.deepEqual(r.review!.eligible!.sort(), voters.map((v) => alias(v.slack)).sort());
  const spin = r.session.activeDraw!.spins[0];
  assert.equal(end, Date.parse(spin.startAt) + spin.durationMs + 60000);
  assert.equal(r.review!.closesAt, end + 10 * 60000);
  assert.equal(r.slack!.card!.kind === "winner" && r.slack!.card!.reviewUntil, end + 10 * 60000);
  // Before the wheels stop no ballot may name the winner.
  assert.equal(reviewBallot(r, alias(voters[0].slack), end - 1), undefined);
  assert.throws(
    () => submitReview(r, alias(voters[0].slack), "d1", { scores: [5], texts: [""] }, end - 1),
    { code: "review_closed" },
  );
  const ballot = reviewBallot(r, alias(voters[0].slack), end)!;
  assert.deepEqual(ballot.winners, [{ index: 0, name: winner.name }]);
  assert.equal(ballot.submitted, false);
  // The winner gets no ballot and cannot vote on themselves.
  assert.equal(reviewBallot(r, alias(winner.slack), end), undefined);
  assert.throws(
    () => submitReview(r, alias(winner.slack), "d1", { scores: [5], texts: [""] }, end),
    { code: "review_forbidden" },
  );
  // Strangers neither.
  assert.throws(
    () => submitReview(r, "pseudo-U00000009", "d1", { scores: [5], texts: [""] }, end),
    { code: "review_forbidden" },
  );
  // Shared screens see counts only.
  assert.deepEqual(publicSession(r).review, {
    closesAt: new Date(end + 10 * 60000).toISOString(),
    voted: 0,
    eligible: 2,
  });
  assert.ok(!JSON.stringify(publicSession(r)).includes("pseudo-"));
  assert.ok(!JSON.stringify(publicSession(r)).includes("U0000000"));
});

test("one strict ballot per person; the last vote closes, keeps no voter and erases the key", () => {
  const { r, winner, voters, end } = drawnRound();
  const [first, second] = voters.map((v) => alias(v.slack));
  for (const bad of [
    { scores: [6], texts: [""] },
    { scores: [0], texts: [""] },
    { scores: [4.5], texts: [""] },
    { scores: [5, 5], texts: ["", ""] },
    { scores: [5], texts: ["x".repeat(281)] },
    { scores: [5], texts: [""], extra: 1 },
    { scores: [5] },
    null,
  ])
    assert.throws(() => submitReview(r, first, "d1", bad, end), { code: "invalid" }, JSON.stringify(bad));
  assert.throws(() => submitReview(r, first, "other", { scores: [5], texts: [""] }, end), { code: "review_closed" });
  assert.equal(
    submitReview(r, first, "d1", { scores: [5], texts: ["  <!channel> top\u202E & snel  "] }, end),
    false,
  );
  assert.throws(() => submitReview(r, first, "d1", { scores: [1], texts: [""] }, end), { code: "review_done" });
  assert.equal(reviewBallot(r, first, end)!.submitted, true);
  assert.equal(submitReview(r, second, "d1", { scores: [4], texts: [""] }, end + 1000), true);
  closeReview(r, end + 1000);
  assert.equal(r.review!.status, "closed");
  const stored = JSON.stringify(r.review);
  for (const secret of ["pseudo-", "ab".repeat(32), "example.test"])
    assert.ok(!stored.includes(secret), secret);
  assert.deepEqual(r.review!.job!.results, [
    { name: winner.name, mentionId: winner.slack, average: 4.5, count: 2, texts: ["<!channel> top & snel"] },
  ]);
  // The call now shows the stars; the review post is due at once.
  const card = r.slack!.card!;
  assert.deepEqual(card.kind === "winner" && card.ratings, [{ average: 4.5, count: 2 }]);
  assert.equal(card.status, "pending");
  assert.equal(reviewDeadline(r), end + 1000);
  assert.throws(() => submitReview(r, first, "d1", { scores: [5], texts: [""] }, end + 2000), { code: "review_closed" });
  // Once posted (or uncertain, or given up) the texts are gone too.
  settleReviewJob(r.review!.job!, "posted");
  assert.deepEqual(r.review!.job!.results, []);
});

test("nobody voting posts nothing; nobody able to vote leaves the call alone", () => {
  let { r, end } = drawnRound(5);
  closeReview(r, end + 5 * 60000);
  assert.equal(r.review!.job, undefined);
  assert.deepEqual(r.slack!.card!.kind === "winner" && r.slack!.card!.ratings, [null]);
  // A round with one participant: the winner, so no ballots at all.
  r = newSession("host", "viewer", now, "coffee");
  r.expiresAt = startAt + 3600000;
  r.scheduledDraw = { startAt: new Date(startAt).toISOString(), status: "skipped" };
  r.slack = { grantHash: "slack-channel", mapping: { U00000001: "p1" }, source: { channelId: "C00000001", parentMessageTs: "1234567890.123456", reactionName: "coffee" }, channelRound: true };
  r.review = { minutes: 5, key: "ab".repeat(32), link: "https://example.test/", status: "waiting" };
  r.session = startDraw(createSession("s1", [{ id: "p1", name: "Alice" }], 1), { id: "d1", startAt: new Date(startAt).toISOString() });
  queueResult(r);
  openReview(r, new Map([["U00000001", alias("U00000001")]]));
  assert.equal(r.review.status, "closed");
  assert.equal(r.review.key, undefined);
  const card = r.slack.card!;
  assert.equal(card.kind === "winner" && card.reviewUntil, undefined);
  assert.equal(card.kind === "winner" && card.ratings, undefined);
  // Voting always closes before the session ends.
  ({ r, end } = drawnRound(30));
  assert.ok(r.review!.closesAt! <= r.expiresAt - 60000);
});

test("the call invites to review while open and shows five decimal stars after", () => {
  const startedAt = Date.parse("2026-10-06T12:58:00Z");
  const base = { kind: "winner" as const, names: ["Nick"], mentionIds: ["U00000001"], participants: 7 };
  const open = settledCallBody("C00000001", "1234567890.123456", startedAt, "coffee", { ...base, reviewUntil: startedAt + 11 * 60000 }, "https://example.test/#/koffie/abc");
  assert.equal(open.text, "☕ Koffieronde om 14:58\n🏆 Nick haalt koffie\n⭐ Beoordeel de haler tot 15:09: https://example.test/#/koffie/abc");
  assert.deepEqual(open.blocks[0].elements![0].elements.at(-1), { type: "link", url: "https://example.test/#/koffie/abc", text: "Open de ronde" });
  // Without the link (review closed) there is no invitation.
  const nolink = settledCallBody("C00000001", "1", startedAt, "coffee", { ...base, reviewUntil: startedAt + 60000 });
  assert.ok(!nolink.text.includes("Beoordeel"));
  const rated = settledCallBody("C00000001", "1", startedAt, "coffee", { ...base, ratings: [{ average: 4.25, count: 6 }] });
  assert.equal(rated.text, "☕ Koffieronde om 14:58\n🏆 Nick haalde koffie · :star::star::star::star::bierrad_star_3: 4.3");
  assert.deepEqual(rated.blocks[0].elements![0].elements.filter((e) => e.type === "emoji"), [
    ...Array.from({ length: 4 }, () => ({ type: "emoji", name: "star" })),
    { type: "emoji", name: "bierrad_star_3" },
  ]);
  assert.equal(rated.blocks[1].elements![0].text, "7 deden mee · 6 beoordelingen in de thread");
  assert.ok(!JSON.stringify(rated).includes("http"));
  const none = settledCallBody("C00000001", "1", startedAt, "water", { ...base, ratings: [null] });
  assert.equal(none.text, "💧 Waterronde om 14:58\n🏆 Nick haalde water");
  assert.equal(none.blocks[1].elements![0].text, "7 deden mee · geen beoordelingen");
});

test("the review post quotes anonymous texts literally, in the thread only", () => {
  const body = reviewBody("C00000001", "1234567890.123456", [
    { name: "<@U00000002>", mentionId: "U00000001", average: 4.25, count: 2, texts: ["<!here> *vet* <https://evil.example|klik>"] },
  ]);
  assert.equal(body.thread_ts, "1234567890.123456");
  assert.equal(body.reply_broadcast, false);
  assert.equal(body.parse, "none");
  assert.equal(body.mrkdwn, false);
  assert.equal(body.unfurl_links, false);
  // Escaped fallback: only the frozen identity is a mention (so Slack notifies);
  // the name and texts cannot mention, broadcast or link.
  assert.deepEqual(body.text.match(/<[^>]*>/g), ["<@U00000001>"]);
  assert.ok(body.text.includes("&lt;!here&gt;"));
  assert.ok(!body.text.includes("U00000002"));
  const manual = reviewBody("C00000001", "1", [
    { name: "<@U00000002>", mentionId: null, average: 3, count: 1, texts: [] },
  ]);
  assert.ok(!/<[!@h]/.test(manual.text));
  assert.ok(manual.text.includes("&lt;@U00000002&gt;"));
  const blocks = body.blocks[0].elements as { type: string; elements: Record<string, unknown>[] }[];
  assert.deepEqual(blocks[0].elements[1], { type: "user", user_id: "U00000001" });
  assert.deepEqual(blocks[1], {
    type: "rich_text_list",
    style: "bullet",
    elements: [
      {
        type: "rich_text_section",
        elements: [{ type: "text", text: "<!here> *vet* <https://evil.example|klik>" }],
      },
    ],
  });
  // Every review is its own bullet, also in the fallback.
  const two = reviewBody("C00000001", "1", [
    { name: "Nick", mentionId: null, average: 3, count: 2, texts: ["Lekker", "Troebel"] },
  ]);
  const list = (two.blocks[0].elements as { elements?: unknown[] }[])[1];
  assert.equal(list.elements!.length, 2);
  assert.ok(two.text.endsWith("• Lekker\n• Troebel"));
  // Without texts there is no empty list.
  const silent = reviewBody("C00000001", "1", [
    { name: "Nick", mentionId: null, average: 3, count: 1, texts: [] },
  ]);
  assert.equal((silent.blocks[0].elements as unknown[]).length, 1);
  assert.ok(!JSON.stringify(body).includes('"type":"link"'));
  assert.ok(!JSON.stringify(body).includes('"type":"broadcast"'));
});

test("review texts turn emoji shortcodes into emoji, nothing else", () => {
  const bullet = (text: string) =>
    (
      reviewBody("C00000001", "1", [
        { name: "Nick", mentionId: null, average: 3, count: 1, texts: [text] },
      ]).blocks[0].elements as { elements?: { elements: unknown[] }[] }[]
    )[1].elements![0].elements;
  assert.deepEqual(bullet("Geen Krispy Kreme... :joeri-banger:"), [
    { type: "text", text: "Geen Krispy Kreme... " },
    { type: "emoji", name: "joeri-banger" },
  ]);
  assert.deepEqual(bullet(":tim-koek::+1: top :-1:"), [
    { type: "emoji", name: "tim-koek" },
    { type: "emoji", name: "+1" },
    { type: "text", text: " top " },
    { type: "emoji", name: "-1" },
  ]);
  // A skin tone right after a shortcode belongs to that emoji, as Slack writes it.
  assert.deepEqual(bullet(":+1::skin-tone-4: top :wave::skin-tone-7: :skin-tone-2:"), [
    { type: "emoji", name: "+1", skin_tone: 4 },
    { type: "text", text: " top " },
    { type: "emoji", name: "wave" },
    { type: "emoji", name: "skin-tone-7" },
    { type: "text", text: " " },
    { type: "emoji", name: "skin-tone-2" },
  ]);
  // Times, uppercase, spaces, markup and our own star emoji stay literal text.
  for (const text of ["om 12:30:00", ":Tim: of : x :", "<!here> :a b:", "::", ":bierrad_star_9:"])
    assert.deepEqual(bullet(text), [{ type: "text", text }]);
  // A shortcode cannot smuggle in a mention or link.
  assert.deepEqual(bullet(":<@U00000001>:"), [{ type: "text", text: ":<@U00000001>:" }]);
});

test("review texts are cleaned and bounded; submissions are exact", () => {
  assert.equal(cleanReviewText("  a\t b \r\n\n\n c\u0000\u200B\u202Ed "), "a b\n\nc d");
  assert.equal(cleanReviewText("👩\u200D💻 top"), "👩\u200D💻 top");
  assert.equal(cleanReviewText("\n\n"), "");
  assert.ok(validSubmission({ scores: [1, 5], texts: ["", "x".repeat(280)] }, 2));
  assert.ok(!validSubmission({ scores: [1], texts: [""] }, 2));
  assert.ok(!validSubmission({ scores: ["5"], texts: [""] }, 1));
  assert.ok(!validSubmission({ scores: [5], texts: [5] }, 1));
});

test("a personal login is bound to its channel object in the login cookie", () => {
  const env = { SLACK_BOT_TOKEN: "synthetic", SLACK_CLIENT_ID: "1.2", SLACK_CLIENT_SECRET: "synthetic" };
  const locator = "a".repeat(32);
  const login = beginLogin(env, "coffee", "https://api.example.test/auth/slack/callback", now, undefined, locator);
  const cookie = login.cookie.split(";")[0];
  assert.ok(cookie.startsWith(`${LOGIN_COOKIE}=member-${locator}.`));
  const pending = parseLoginCookie(cookie, now)!;
  assert.equal(pending.memberLocator, locator);
  assert.equal(pending.variant, "coffee");
  assert.equal(pending.channelId, undefined);
  // The Bierrad app's personal logins carry their own prefix.
  const beer = parseLoginCookie(
    beginLogin(env, "beer", "https://x/cb", now, undefined, locator).cookie.split(";")[0],
    now,
  )!;
  assert.equal(beer.variant, "beer");
  assert.equal(beer.memberLocator, locator);
  assert.throws(() => beginLogin(env, "water" as "beer", "https://x/cb", now, undefined, locator));
  assert.throws(() => beginLogin(env, "coffee", "https://x/cb", now, undefined, "XYZ"));
  assert.equal(parseLoginCookie(`${LOGIN_COOKIE}=member-${"g".repeat(32)}.${"a".repeat(64)}.${"b".repeat(64)}.${now + 1000}`, now), undefined);
});

