import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RoundExplainer } from "../components/RoundExplainer";
import { reviewLabels } from "../../shared/reviews";

test("the round explainer shows five static steps from request to review", () => {
  const html = renderToStaticMarkup(createElement(RoundExplainer));
  const steps = [...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(steps, ["Aanvragen", "Aanmelden", "Draaien", "Winnaar", "Beoordelen"]);
  assert.ok(html.includes("/koffierad 5"));
  assert.ok(html.includes("☕ Koffieronde om 10:05"));
  assert.ok(html.includes(reviewLabels.coffee[0]));
  assert.ok(html.includes(reviewLabels.coffee[4]));
  // Pictures only; screen readers get the step texts.
  assert.equal((html.match(/class="explainer-shot" aria-hidden="true"/g) ?? []).length, 5);
});

test("the Bierrad explainer shows its own call, the reminder and two halers", () => {
  const html = renderToStaticMarkup(createElement(RoundExplainer, { app: "beer" }));
  const steps = [...html.matchAll(/<h3>([^<]+)<\/h3>/g)].map((m) => m[1]);
  assert.deepEqual(steps, ["Aanvragen", "Aanmelden", "Herinnering", "Draaien", "Winnaars", "Beoordelen"]);
  assert.ok(html.includes("/bierrad vrijdag 15.45"));
  assert.ok(html.includes("Het bierronde radje"));
  assert.ok(html.includes("alleen meekijken"));
  assert.ok(html.includes(reviewLabels.beer[0]));
  assert.ok(!html.includes("/koffierad"));
  assert.equal((html.match(/class="explainer-shot" aria-hidden="true"/g) ?? []).length, 6);
});
