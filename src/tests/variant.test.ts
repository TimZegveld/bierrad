import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../App";
import { RoundTitleContext, VariantContext } from "../Theme";
import { ManualParticipantSource } from "../services/ManualParticipantSource";
import { LocalWinnerCountPreference } from "../services/WinnerCountPreference";
import { loadWeights, saveWeights } from "../services/RigPreference";
import { LocalSessionController } from "../sessions/LocalSessionController";
import { FinalResult } from "../components/FinalResult";

test("coffee roster, count and optional weights never overwrite legacy beer storage", async (t) => {
  const data = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  });
  const beer = new ManualParticipantSource(),
    coffee = new ManualParticipantSource("coffee");
  beer.save([{ id: "a", name: "Test A" }]);
  coffee.save([{ id: "b", name: "Test B" }]);
  assert.deepEqual(
    (await beer.getParticipants()).map((p) => p.name),
    ["Test A"],
  );
  assert.deepEqual(
    (await coffee.getParticipants()).map((p) => p.name),
    ["Test B"],
  );
  new LocalWinnerCountPreference().save(3);
  new LocalWinnerCountPreference("coffee").save(1);
  assert.equal(new LocalWinnerCountPreference().load(), 3);
  assert.equal(new LocalWinnerCountPreference("coffee").load(), 1);
  saveWeights({ a: 2 });
  saveWeights({ b: 4 }, "coffee");
  assert.deepEqual(loadWeights(), { a: 2 });
  assert.deepEqual(loadWeights("coffee"), { b: 4 });
  assert.ok(data.has("bierrad.participants.v1"));
});
test("coffee setup and finale consistently say coffee halen", async () => {
  const controller = new LocalSessionController();
  await controller.setParticipants([{ id: "a", name: "Test A" }]);
  const render = (child: import("react").ReactNode) =>
    renderToStaticMarkup(
      createElement(VariantContext.Provider, { value: "coffee" }, child),
    );
  const setup = render(createElement(App, { controller }));
  assert.match(setup, /Koffierad/);
  assert.match(setup, /koffiehaler/);
  assert.match(setup, /DRAAI HET KOFFIERAD/);
  assert.doesNotMatch(setup, /bierhaler|Vrijdag begint|🍺|bier halen/i);
  const result = render(
    createElement(FinalResult, {
      winners: [{ id: "a", name: "Test A" }],
      onAgain() {},
      onSetup() {},
      canControl: true,
      disabled: false,
    }),
  );
  assert.match(result, /Jij mag koffie halen!/);
  assert.doesNotMatch(result, /bier|zetten|🍻/i);
  controller.dispose();
});
test("local routes, reactions and Slack apps come from one theme table", async () => {
  const {
    localHash,
    localVariant,
    reactionVariant,
    retiredRoute,
    standaloneVariants,
    themes,
    wheelVariants,
  } = await import("../../shared/variant");
  assert.equal(localVariant(""), "beer");
  assert.deepEqual(standaloneVariants, ["beer", "coffee"]);
  for (const variant of standaloneVariants)
    assert.equal(localVariant(localHash(variant)), variant);
  for (const variant of wheelVariants)
    assert.equal(reactionVariant(themes[variant].reaction), variant);
  // Water is only a channel round: no own local wheel.
  for (const hash of ["#/water", "#/slack", "#/live/x", "#/koffie-koppelen", "#/Coffee", "#/beer/"])
    assert.equal(localVariant(hash), undefined, hash);
  // Saved water links open the Koffierad instead.
  assert.equal(retiredRoute("#/water"), "#/coffee");
  // Old Slack starts of water and coffee too.
  for (const hash of ["#/water-slack", "#/water-slack/denied", "#/coffee-slack", "#/coffee-slack/busy"])
    assert.equal(retiredRoute(hash), "#/coffee", hash);
  // The removed Bierrad Slack start and its join links open the local Bierrad.
  for (const hash of ["#/slack", "#/slack/denied", `#/meedoen/${"a".repeat(32)}.${"b".repeat(64)}`, "#/meedoen-login/busy"])
    assert.equal(retiredRoute(hash), "#/beer", hash);
  for (const hash of ["", "#/coffee", "#/water/", "#/waterrad", "#/koffie/x", "#/meedoen"])
    assert.equal(retiredRoute(hash), undefined, hash);
  assert.equal(themes.beer.slackApp, "beer");
  assert.equal(themes.coffee.slackApp, "coffee");
});
test("the switcher offers only the Bierrad and Koffierad", async () => {
  const controller = new LocalSessionController();
  for (const variant of ["beer", "coffee", "water"] as const) {
    const page = renderToStaticMarkup(
      createElement(VariantContext.Provider, { value: variant }, createElement(App, { controller })),
    );
    const nav = /<nav class="variant-switch"[^>]*>(.*?)<\/nav>/s.exec(page)?.[1] ?? "";
    assert.deepEqual([...nav.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ["#/beer", "#/coffee"], variant);
    assert.doesNotMatch(nav, /Waterrad|💧/);
  }
  controller.dispose();
});
test("water setup and finale say water halen", async () => {
  const controller = new LocalSessionController();
  await controller.setParticipants([{ id: "a", name: "Test A" }]);
  const render = (child: import("react").ReactNode) =>
    renderToStaticMarkup(
      createElement(VariantContext.Provider, { value: "water" }, child),
    );
  const setup = render(createElement(App, { controller }));
  assert.match(setup, /Waterrad/);
  assert.match(setup, /waterhaler/);
  assert.match(setup, /DRAAI HET WATERRAD/);
  assert.doesNotMatch(setup, /bierhaler|koffiehaler|Vrijdag begint|bier halen/i);
  const result = render(
    createElement(FinalResult, {
      winners: [{ id: "a", name: "Test A" }],
      onAgain() {},
      onSetup() {},
      canControl: true,
      disabled: false,
    }),
  );
  assert.match(result, /Jij mag water halen!/);
  assert.match(result, /Rondje gemeentepils van de zaak! Hydrateer ons trots\./);
  assert.doesNotMatch(result, /bier|koffie/i);
  controller.dispose();
});
test("a Koekrad round takes its word: titles are one plain word, never markup", async () => {
  const { roundTitle, themeFor, themes, standaloneVariants } = await import("../../shared/variant");
  const { roundCopy } = await import("../../shared/channel");
  assert.equal(themes.cookie.name, "Koekrad");
  assert.equal(themes.cookie.reaction, "cookie");
  assert.equal(themes.cookie.slackApp, "coffee");
  assert.ok(!(standaloneVariants as readonly string[]).includes("cookie"));
  assert.equal(themeFor("cookie", "taart").name, "Taartrad");
  assert.equal(themeFor("cookie", "Bitterballen").name, "Bitterballenrad");
  assert.equal(themeFor("cookie", "ijs").name, "IJsrad");
  assert.equal(themeFor("cookie", "appel-taart").finale, "DE APPEL-TAARTBRIGADE VAN DEZE RONDE");
  assert.equal(themeFor("cookie", "taart").resultOne, "mag de taart halen.");
  assert.equal(roundCopy("cookie", "taart").round, "taartronde");
  assert.equal(roundCopy("cookie").round, "koekronde");
  // Only the Koekrad takes a word, and only a valid one.
  assert.equal(themeFor("coffee", "taart"), themes.coffee);
  assert.equal(roundCopy("water", "taart").round, "waterronde");
  assert.equal(themeFor("cookie", "<b>x</b>"), themes.cookie);
  assert.equal(roundTitle("Crème"), "crème");
  for (const bad of [undefined, 5, "", "a", "a".repeat(21), "twee woorden", "koek1", "@here", ":cookie:", "-koek", "koek--x", "koek\u200b"])
    assert.equal(roundTitle(bad), undefined, String(bad));
});
test("a titled Koekrad round shows its word everywhere, as plain text", () => {
  const controller = new LocalSessionController();
  const render = (title?: string) =>
    renderToStaticMarkup(
      createElement(
        VariantContext.Provider,
        { value: "cookie" },
        createElement(RoundTitleContext.Provider, { value: title }, createElement(App, { controller })),
      ),
    );
  // The switcher always names the main wheels; everything else is the round's.
  const taart = render("taart").replace(/<nav class="variant-switch".*?<\/nav>/s, "");
  assert.match(taart, /Taartrad/);
  assert.match(taart, /DRAAI HET TAARTRAD/);
  assert.doesNotMatch(taart, /Koekrad|bier|koffie/i);
  assert.match(render(), /Koekrad/);
  // An invalid word never reaches the page.
  const forged = render("<img src=x onerror=alert(1)>");
  assert.match(forged, /Koekrad/);
  assert.doesNotMatch(forged, /onerror|&lt;img/);
  controller.dispose();
});
test("water roster and count are stored apart from beer and coffee", () => {
  const data = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => data.set(k, v),
    },
  });
  try {
    new ManualParticipantSource("water").save([{ id: "w", name: "Test W" }]);
    new LocalWinnerCountPreference("water").save(1);
    assert.deepEqual([...data.keys()].sort(), [
      "waterrad.participants.v1",
      "waterrad.winnerCount.v1",
    ]);
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
