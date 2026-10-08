import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amsterdamInput,
  parseAmsterdamInput,
  nextFridayInput,
} from "../utils/schedule";

test("Friday default and Dutch date conversion are independent of browser timezone and follow DST", () => {
  assert.equal(
    nextFridayInput(Date.parse("2026-10-02T10:00:00Z")),
    "2026-10-02T15:45",
  );
  assert.equal(
    nextFridayInput(Date.parse("2026-10-02T14:00:00Z")),
    "2026-10-09T15:45",
  );
  assert.equal(
    new Date(parseAmsterdamInput("2026-10-02T15:45")).toISOString(),
    "2026-10-02T13:45:00.000Z",
  );
  assert.equal(
    new Date(parseAmsterdamInput("2026-10-30T15:45")).toISOString(),
    "2026-10-30T14:45:00.000Z",
  );
  assert.equal(
    amsterdamInput(Date.parse("2026-10-30T14:45:00Z")),
    "2026-10-30T15:45",
  );
  for (const value of ["", "bad", "2026-03-29T02:30", "2026-02-30T15:45"])
    assert.ok(Number.isNaN(parseAmsterdamInput(value)));
});

test("schedule button stays available when the selected start is after the old session expiry", async (t) => {
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { ScheduleControls } = await import("../components/ScheduleControls");
  t.mock.timers.enable({
    apis: ["Date"],
    now: Date.parse("2026-10-02T10:00:00Z"),
  });
  const html = renderToStaticMarkup(
    createElement(ScheduleControls, {
      expiresAt: "2026-10-02T12:27:00Z",
      locked: false,
      async onSave() {},
    }),
  );
  assert.match(html, /2026-10-02T15:45/);
  assert.match(html, /verlengen we deze sessie/);
  assert.match(html, /16:45/);
  assert.doesNotMatch(html, /<button[^>]*disabled/);
});
