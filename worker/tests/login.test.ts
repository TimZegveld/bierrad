import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginLogin,
  completeLogin,
  LoginError,
  LOGIN_COOKIE,
  parseLoginCookie,
} from "../slack/login";
import { randomHex } from "../auth";

const env = {
  SLACK_BOT_TOKEN: "synthetic-bot-credential",
  SLACK_CLIENT_ID: "1000000000.2000000000",
  SLACK_CLIENT_SECRET: "synthetic-client-secret",
};
const redirect = "https://worker.invalid/auth/slack/callback";
const team = "T00000001";
const encode = (value: object) =>
  btoa(JSON.stringify(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const idToken = (claims: object) =>
  `${encode({ alg: "RS256" })}.${encode(claims)}.c2lnbmF0dXJl`;

function slack(
  options: {
    claims?: object;
    member?: object;
    token?: object;
    botTeam?: string;
  } = {},
  pending = { state: randomHex(), nonce: randomHex() },
) {
  const calls: {
    path: string;
    url: string;
    auth: string | null;
    body: string;
  }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://slack.com");
    assert.equal(init?.redirect, "manual");
    const path = url.pathname.replace("/api/", "");
    calls.push({
      path,
      url: url.href,
      auth: new Headers(init?.headers).get("authorization"),
      body: String(init?.body ?? ""),
    });
    if (path === "auth.test")
      return Response.json({ ok: true, team_id: options.botTeam ?? team });
    if (path === "auth.revoke") return Response.json({ ok: true });
    if (path === "openid.connect.token")
      return Response.json(
        options.token ?? {
          ok: true,
          access_token: "synthetic-user-credential",
          id_token: idToken({
            iss: "https://slack.com",
            aud: env.SLACK_CLIENT_ID,
            exp: Math.floor(Date.now() / 1000) + 300,
            nonce: pending.nonce,
            sub: "U00000001",
            "https://slack.com/user_id": "U00000001",
            "https://slack.com/team_id": team,
            ...options.claims,
          }),
        },
      );
    assert.equal(path, "users.info");
    return Response.json({
      ok: true,
      user: {
        id: url.searchParams.get("user"),
        team_id: team,
        deleted: false,
        is_bot: false,
        is_restricted: false,
        is_ultra_restricted: false,
        ...options.member,
      },
    });
  }) as typeof fetch;
  const run = (params?: Record<string, string>) =>
    completeLogin(
      env,
      { variant: "beer", expiresAt: Date.now() + 60000, ...pending },
      new URLSearchParams(
        params ?? { code: "synthetic.code-1", state: pending.state },
      ),
      redirect,
      fetcher,
    );
  return { calls, run, pending };
}
const rejects = (promise: Promise<unknown>, reason: string) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof LoginError && e.reason === reason,
  );

test("login start sends only public OIDC parameters and a host-only short-lived cookie", async () => {
  assert.throws(
    () =>
      beginLogin({ ...env, SLACK_CLIENT_SECRET: undefined }, "coffee", redirect, Date.now(), "C00000001"),
    (e: unknown) => e instanceof LoginError && e.reason === "unavailable",
  );
  // A login only binds a channel or gives a personal link; none starts a session.
  for (const variant of ["beer", "coffee"] as const)
    assert.throws(
      () => beginLogin(env, variant, redirect),
      (e: unknown) => e instanceof LoginError && e.reason === "expired",
    );
  const start = beginLogin(env, "coffee", redirect, Date.now(), "C00000001");
  const url = new URL(start.location);
  assert.equal(
    url.origin + url.pathname,
    "https://slack.com/openid/connect/authorize",
  );
  assert.equal(url.searchParams.get("scope"), "openid");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), env.SLACK_CLIENT_ID);
  assert.equal(url.searchParams.get("redirect_uri"), redirect);
  assert.equal(url.searchParams.has("team"), false);
  assert.ok(!start.location.includes(env.SLACK_CLIENT_SECRET));
  assert.ok(!start.location.includes(env.SLACK_BOT_TOKEN));
  for (const attribute of [
    `${LOGIN_COOKIE}=channel-C00000001.`,
    "Path=/",
    "Max-Age=600",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ])
    assert.ok(start.cookie.includes(attribute));
  assert.ok(!start.cookie.includes("Domain"));
  const pending = parseLoginCookie(start.cookie.split(";")[0]);
  assert.equal(pending?.variant, "coffee");
  assert.equal(pending?.channelId, "C00000001");
  // Plain and session-join logins of the removed Slack start are refused.
  for (const other of ["beer", "coffee", `join-beer-${"a".repeat(32)}`])
    assert.equal(
      parseLoginCookie(
        start.cookie.split(";")[0].replace("=channel-C00000001.", `=${other}.`),
      ),
      undefined,
    );
  assert.equal(pending?.state, url.searchParams.get("state"));
  assert.equal(pending?.nonce, url.searchParams.get("nonce"));
});

test("login cookie parsing fails closed on expiry, duplicates and malformed values", () => {
  const value = `channel-C00000001.${randomHex()}.${randomHex()}.${Date.now() + 60000}`;
  assert.ok(parseLoginCookie(`other=1; ${LOGIN_COOKIE}=${value}`));
  assert.equal(parseLoginCookie(null), undefined);
  assert.equal(
    parseLoginCookie(`${LOGIN_COOKIE}=${value}; ${LOGIN_COOKIE}=${value}`),
    undefined,
  );
  assert.equal(
    parseLoginCookie(
      `${LOGIN_COOKIE}=${value.replace(/\d{13}$/, String(Date.now() - 1))}`,
    ),
    undefined,
  );
  assert.equal(
    parseLoginCookie(`${LOGIN_COOKIE}=${value.replace("channel-C00000001", "tea")}`),
    undefined,
  );
});

test("full members log in; the user token is revoked and the client secret stays out of URLs", async () => {
  const { calls, run } = slack();
  await run();
  const token = calls.find((c) => c.path === "openid.connect.token")!;
  assert.equal(token.auth, null);
  assert.ok(token.body.includes("client_secret=synthetic-client-secret"));
  assert.ok(calls.every((c) => !c.url.includes(env.SLACK_CLIENT_SECRET)));
  const revoke = calls.find((c) => c.path === "auth.revoke")!;
  assert.equal(revoke.auth, "Bearer synthetic-user-credential");
  assert.ok(
    calls
      .filter((c) => ["auth.test", "users.info"].includes(c.path))
      .every((c) => c.auth === `Bearer ${env.SLACK_BOT_TOKEN}`),
  );
});

test("callback rejects forged, cancelled or replayed flows before calling Slack", async () => {
  const { calls, run, pending } = slack();
  await rejects(run({ code: "c", state: randomHex() }), "expired");
  await rejects(run({ code: "c" }), "expired");
  await rejects(
    run({ code: "c", state: pending.state, error: "access_denied" }),
    "denied",
  );
  await rejects(run({ state: pending.state }), "expired");
  await rejects(run({ state: pending.state, code: "bad code" }), "expired");
  const twice = new URLSearchParams({ code: "c", state: pending.state });
  twice.append("state", pending.state);
  await rejects(
    completeLogin(
      env,
      { variant: "beer", expiresAt: Date.now() + 60000, ...pending },
      twice,
      redirect,
    ),
    "expired",
  );
  assert.equal(calls.length, 0);
  const rejected = slack({ token: { ok: false, error: "invalid_code" } });
  await rejects(rejected.run(), "expired");
});

test("only full members of the bot workspace with matching OIDC claims may start", async () => {
  const cases: [object, string][] = [
    [{ claims: { nonce: randomHex() } }, "forbidden"],
    [{ claims: { aud: "1.2" } }, "forbidden"],
    [{ claims: { aud: [env.SLACK_CLIENT_ID, "1.2"] } }, "forbidden"],
    [{ claims: { iss: "https://evil.invalid" } }, "forbidden"],
    [{ claims: { exp: Math.floor(Date.now() / 1000) - 1 } }, "forbidden"],
    [{ claims: { sub: "bad" } }, "forbidden"],
    [{ claims: { "https://slack.com/user_id": "U00000002" } }, "forbidden"],
    [{ claims: { "https://slack.com/team_id": "T00000002" } }, "forbidden"],
    [{ botTeam: "T00000002" }, "forbidden"],
    [{ member: { is_restricted: true } }, "forbidden"],
    [{ member: { is_ultra_restricted: true } }, "forbidden"],
    [{ member: { is_stranger: true } }, "forbidden"],
    [{ member: { team_id: "T00000002" } }, "forbidden"],
    [{ member: { deleted: true } }, "forbidden"],
    [{ member: { deleted: undefined } }, "forbidden"],
    [{ member: { is_bot: true } }, "forbidden"],
    [{ member: { is_app_user: true } }, "forbidden"],
    [{ member: { id: "U00000002" } }, "forbidden"],
    [{ token: { ok: true, id_token: "not-a-jwt" } }, "forbidden"],
  ];
  for (const [options, reason] of cases) {
    const { calls, run } = slack(options);
    await rejects(run(), reason);
    if (!("token" in options))
      assert.ok(calls.some((c) => c.path === "auth.revoke"));
  }
});
