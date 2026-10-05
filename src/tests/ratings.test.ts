import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RatingStars } from "../components/RatingStars";
import { RatingSettingsControl } from "../components/RatingSettingsControl";
import { BeerWheel } from "../components/BeerWheel";
import { VariantContext } from "../Theme";
import { wheelVariants } from "../../shared/variant";

test("fractional star graphics preserve averages, accessible counts and unique clipping IDs", () => {
  const html = renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement(RatingStars, { rating: { average: 1.8, count: 10 } }),
      createElement(RatingStars, { rating: { average: 4.3, count: 20 } }),
      createElement(RatingStars, { rating: { average: 0, count: 0 } }),
    ),
  );
  assert.ok(html.includes("1,8 van 5 sterren, 10 beoordelingen"));
  assert.ok(html.includes("4,3 van 5 sterren, 20 beoordelingen"));
  assert.ok(html.includes("Nog geen beoordelingen"));
  const ids = [...html.matchAll(/clipPath id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(ids.length, 15);
  assert.equal(new Set(ids).size, 15);
  const widths = [...html.matchAll(/rect width="([^"]+)"/g)].map((m) =>
    Number(m[1]),
  );
  assert.ok(widths.some((w) => Math.abs(w - 16) < 0.001));
  assert.ok(widths.some((w) => Math.abs(w - 6) < 0.001));
});

test("ratings start disabled and the enabled control explains the delay and one vote rule", () => {
  const off = renderToStaticMarkup(
    createElement(RatingSettingsControl, { onChange() {} }),
  );
  assert.ok(!off.includes("checked"));
  const on = renderToStaticMarkup(
    createElement(RatingSettingsControl, {
      value: { enabled: true, delayMinutes: 3 },
      onChange() {},
    }),
  );
  assert.ok(on.includes('value="3"'));
  assert.ok(on.includes("minuten na de trekking"));
  assert.ok(on.includes("Eén keer per trekking"));
});

test("every wheel theme renders fractional stars under both orientations of a name without choosing winners", () => {
  const people = [
    { id: "a", name: "Testpersoon A", rating: { average: 1.8, count: 10 } },
    { id: "b", name: "Testpersoon B", rating: { average: 4.3, count: 20 } },
  ];
  for (const variant of wheelVariants) {
    const html = renderToStaticMarkup(
      createElement(
        VariantContext.Provider,
        { value: variant },
        createElement(BeerWheel, { people, spinning: false }),
      ),
    );
    assert.equal([...html.matchAll(/class="wheel-rating"/g)].length, 2);
    assert.ok(html.includes("1,8 van 5 sterren"));
    assert.ok(html.includes("4,3 van 5 sterren"));
    assert.ok(html.includes("rotate(180 333 210)"));
  }
});
