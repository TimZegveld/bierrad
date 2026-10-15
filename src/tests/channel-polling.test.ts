import { test } from "node:test";
import assert from "node:assert/strict";
import { ChannelApiError, channelRequest } from "../sessions/ChannelClient";
import { ChannelPoller } from "../sessions/ChannelPoller";

test("channel polling recovers from 503 and only a 404 ends access", async () => {
  let status = 503;
  let calls = 0;
  const received: unknown[] = [],
    errors: boolean[] = [];
  const poller = new ChannelPoller(
    () =>
      channelRequest(
        "https://api.example.test",
        "synthetic",
        undefined,
        async () => {
          calls++;
          return Response.json(
            status === 200 ? { type: "view" } : { code: "unavailable" },
            { status },
          );
        },
      ),
    (value) => received.push(value),
    (_error, terminal) => errors.push(terminal),
  );
  try {
    await poller.refresh();
    assert.deepEqual(errors, [false]);
    status = 200;
    await poller.refresh();
    assert.deepEqual(received, [{ type: "view" }]);
    status = 404;
    await poller.refresh();
    assert.deepEqual(errors, [false, true]);
    await poller.refresh();
    assert.equal(calls, 3);
  } finally {
    poller.stop();
  }
});

test("slow polls never overlap and disposed responses do not reach the page", async () => {
  let resolve!: (value: number) => void;
  let calls = 0;
  const received: number[] = [];
  const poller = new ChannelPoller(
    () => {
      calls++;
      return new Promise<number>((done) => {
        resolve = done;
      });
    },
    (value) => received.push(value),
    () => assert.fail("unexpected error"),
  );
  const first = poller.refresh();
  await poller.refresh();
  assert.equal(calls, 1);
  poller.stop();
  resolve(1);
  await first;
  assert.deepEqual(received, []);
  assert.equal(new ChannelApiError("unavailable", 503).terminal, false);
});

test(
  "a temporary failure retries automatically without a page reload",
  { timeout: 1000 },
  async () => {
    let calls = 0;
    let recovered!: () => void;
    const done = new Promise<void>((resolve) => {
      recovered = resolve;
    });
    const poller = new ChannelPoller(
      async () => {
        if (++calls === 1) throw new ChannelApiError("unavailable", 503);
        return "recovered";
      },
      () => recovered(),
      (_error, terminal) => assert.equal(terminal, false),
      1,
    );
    try {
      await poller.refresh();
      await done;
      assert.equal(calls, 2);
    } finally {
      poller.stop();
    }
  },
);
