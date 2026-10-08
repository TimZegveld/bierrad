import { test } from "node:test";
import assert from "node:assert/strict";
import { slackRating } from "../slack/rating";
import { reviewBody, settledCallBody } from "../channel/messages";

test("Slack ratings always contain five stars, with tenths matching the printed score", () => {
  assert.deepEqual(slackRating(3.7).elements.map((e) => e.name), [
    "star", "star", "star", "bierrad_star_7", "bierrad_star_empty",
  ]);
  for (let tenth = 0; tenth <= 50; tenth++) {
    const display = slackRating(tenth / 10);
    assert.equal(display.elements.length, 5);
    assert.equal(display.value, (tenth / 10).toFixed(1));
    const represented = display.elements.reduce((sum, e) => sum + (
      e.name === "star" ? 10 : e.name === "bierrad_star_empty" ? 0 : Number(e.name.slice(-1))
    ), 0);
    assert.equal(represented, tenth);
    assert.equal(display.text, display.elements.map((e) => `:${e.name}:`).join(""));
  }
  for (const [input, expected] of [[4.25, "4.3"], [3.6999999999999997, "3.7"], [3.94, "3.9"], [3.95, "4.0"], [4.96, "5.0"]] as const)
    assert.equal(slackRating(input).value, expected);
  assert.ok(slackRating(4.96).elements.every((e) => e.name === "star"));
  assert.ok(slackRating(1).elements.slice(1).every((e) => e.name === "bierrad_star_empty"));
});

test("both review replies and channel cards use five emoji elements per rated winner", () => {
  const results = [
    { name: "Alice", mentionId: "U00000001", average: 3.7, count: 10, texts: [] },
    { name: "Bob", mentionId: null, average: 2, count: 1, texts: [":bierrad_star_9: <!channel>"] },
  ];
  // One reply per winner, so each haler can get their own reactions.
  const replies = results.map((result) => reviewBody("C00000001", "1234567890.123456", result));
  for (const [i, reply] of replies.entries()) {
    const head = (reply.blocks[0].elements as { type: string; elements: Record<string, unknown>[] }[])[0];
    assert.deepEqual(head.elements.filter((e) => e.type === "emoji"), slackRating(results[i].average).elements);
  }
  const reply = replies[0];
  const sections = replies[1].blocks[0].elements as { type: string; elements: Record<string, unknown>[] }[];
  assert.deepEqual(sections.at(-1), {
    type: "rich_text_list",
    style: "bullet",
    elements: [{ type: "rich_text_section", elements: [{ type: "text", text: results[1].texts[0] }] }],
  });
  const card = settledCallBody("C00000001", "1234567890.123456", Date.parse("2026-10-06T12:00:00Z"), "water", {
    kind: "winner", names: results.map((r) => r.name), mentionIds: results.map((r) => r.mentionId), participants: 12,
    ratings: results.map(({ average, count }) => ({ average, count })),
  });
  assert.deepEqual(card.blocks[0].elements![0].elements.filter((e) => e.type === "emoji"), results.flatMap((r) => slackRating(r.average).elements));
  assert.match(reply.text, /:star::star::star::bierrad_star_7::bierrad_star_empty: {2}3\.7/);
  assert.ok(!JSON.stringify(card).includes('"type":"link"'));
});
