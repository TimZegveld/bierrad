import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReviewBallot } from "../../shared/reviews";
import { draftFor, ReviewBallotCard } from "../components/ReviewBallot";

const ballot: ReviewBallot = {
  drawId: "draw-1",
  closesAt: "2026-10-07T14:00:00.000Z",
  winners: [
    { index: 0, name: "Ada" },
    { index: 1, name: "Bas" },
  ],
  submitted: false,
};

test("a review draft is kept for its own draw and starts empty for a new one", () => {
  const kept = { drawId: "draw-1", scores: [4, undefined], texts: ["Lekker", ""] };
  assert.equal(draftFor(ballot, kept), kept);
  assert.deepEqual(draftFor({ ...ballot, drawId: "draw-2" }, kept), {
    drawId: "draw-2",
    scores: [undefined, undefined],
    texts: ["", ""],
  });
  assert.deepEqual(draftFor(ballot).texts, ["", ""]);
  // A draft that no longer fits the winners is never reused.
  assert.deepEqual(
    draftFor(ballot, { drawId: "draw-1", scores: [5], texts: ["x"] }).scores,
    [undefined, undefined],
  );
});

test("a remounted ballot card shows the draft the page kept", () => {
  const html = renderToStaticMarkup(
    createElement(ReviewBallotCard, {
      ballot,
      variant: "coffee",
      draft: { drawId: "draw-1", scores: [3, undefined], texts: ["Koffie was koud", ""] },
      onDraftChange: () => {},
      onSubmit: async () => {},
      onLater: () => {},
    }),
  );
  assert.match(html, /Koffie was koud/);
  assert.equal(html.match(/class="on"/g)?.length, 3);
  assert.match(html, /15 \/ /);
});

test("the channel page renders the ballot first in every layout, never in local storage", () => {
  const page = readFileSync("src/components/ChannelPages.tsx", "utf8");
  // Same position in the round, result and no-round layout, so it is not remounted.
  assert.equal(page.match(/<ChannelTheme[^>]*>\s*\{ballotCard\}/g)?.length, 3);
  for (const file of ["ChannelPages.tsx", "ReviewBallot.tsx"])
    assert.doesNotMatch(
      readFileSync(`src/components/${file}`, "utf8"),
      /localStorage|sessionStorage|indexedDB/,
    );
});
