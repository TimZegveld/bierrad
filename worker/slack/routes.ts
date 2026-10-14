import {
  beginLogin,
  completeLogin,
  loginCookie,
  LoginError,
  parseLoginCookie,
  type PendingLogin,
} from "./login";
import { slackEnvironment, type SlackSecrets } from "./access";
import { frontend, json, readFormBody, redirect } from "../http";
import { parseCapability, randomHex, hashSecret } from "../auth";
import { channelApps, type ChannelApp } from "../../shared/channel";
import { channelLocator } from "../channel/wheel";
import { creationAllowed } from "../limits";
type WorkerEnv = Env & SlackSecrets;
async function saveLogin(env: WorkerEnv, login: ReturnType<typeof beginLogin>) {
  await env.CHANNELS.getByName(`login:${login.locator}`).createLogin(
    login.pending,
    login.secret,
  );
}
/**
 * Sign in with Slack, only to bind a channel or for a personal channel link;
 * it never starts a session. `/auth/slack/channel/<C…>` binds with the
 * Koffierad app, `/auth/slack/beer-channel/<C…>` with the Bierrad app; a
 * personal login uses the app of the channel its link belongs to. Top-level
 * navigations carry no Origin header and the callback needs a query, so these
 * bypass the API gate below and only ever answer with redirects; capabilities
 * go into the URL fragment only.
 */
export async function slackAuth(
  request: Request,
  env: WorkerEnv,
  url: URL,
): Promise<Response> {
  const frontendUrl = frontend(env);
  if (!frontendUrl) return json({ code: "unavailable" }, 503);
  const callback = `${url.origin}/auth/slack/callback`;
  let pending: PendingLogin | undefined;
  const cookie = parseLoginCookie(request.headers.get("Cookie"));
  // The purpose stays server-side; the cookie only locates a one-time attempt.
  const bindStart =
    /^\/auth\/slack\/(channel|beer-channel)\/([CG][A-Z0-9]{8,20})$/.exec(
      url.pathname,
    );
  const callbackPath = url.pathname === "/auth/slack/callback";
  let binding = !!bindStart;
  // A personal channel link: started by a form POST from the channel page.
  const memberStart = url.pathname === "/auth/slack/member";
  let app: ChannelApp = bindStart
    ? bindStart[1] === "beer-channel"
      ? "beer"
      : "coffee"
    : "coffee";
  const clear = loginCookie("", 0);
  const fail = (reason: string) =>
    redirect(
      `${frontendUrl.href}#/${channelApps[app].route}-${binding ? "koppelen" : "login"}/${reason}`,
      clear,
    );
  try {
    if (request.method !== (memberStart ? "POST" : "GET"))
      return json({ code: "invalid" }, 405);
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    if (!(await env.REQUEST_LIMIT.limit({ key: ip })).success)
      return fail("busy");
    if (memberStart) {
      // The channel link travels only in a small form body from an
      // allowed origin, never in a URL; it proves the person already holds it.
      if (
        url.search ||
        !env.ALLOWED_ORIGINS.split(",").includes(
          request.headers.get("Origin") ?? "",
        ) ||
        !request.headers
          .get("Content-Type")
          ?.startsWith("application/x-www-form-urlencoded")
      )
        return fail("expired");
      const form = new URLSearchParams(await readFormBody(request, 1024));
      const capability = parseCapability(form.get("capability"));
      if (
        [...form.keys()].length !== 1 ||
        form.getAll("capability").length !== 1 ||
        !capability?.locator
      )
        return fail("expired");
      const own = await env.CHANNELS.getByName(
        capability.locator,
      ).memberLoginAllowed(capability.secret);
      if (!own) return fail("expired");
      app = own.app;
      const login = beginLogin(
        slackEnvironment(env, app),
        app,
        callback,
        Date.now(),
        undefined,
        capability.locator,
      );
      login.pending.memberAccess = own.access;
      await saveLogin(env, login);
      return redirect(login.location, login.cookie);
    }
    if (bindStart) {
      if (url.search) return fail("expired");
      if (!(await creationAllowed(env, ip))) return fail("busy");
      const login = beginLogin(
        slackEnvironment(env, app),
        app,
        callback,
        Date.now(),
        bindStart[2],
      );
      await saveLogin(env, login);
      return redirect(login.location, login.cookie);
    }
    // `/auth/slack/beer` and other old starts no longer start anything.
    if (
      !callbackPath ||
      !cookie ||
      url.searchParams.getAll("state").length !== 1
    )
      return fail("expired");
    const state = url.searchParams.get("state")!;
    if (!/^[a-f0-9]{64}$/.test(state)) return fail("expired");
    pending =
      (await env.CHANNELS.getByName(`login:${cookie.locator}`).consumeLogin(
        cookie.secret,
        state,
      )) ?? undefined;
    if (!pending) return fail("expired");
    app = pending.variant;
    binding = !!pending.channelId;
    const workspace = await completeLogin(
      slackEnvironment(env, app),
      pending,
      url.searchParams,
      callback,
    );
    const route = channelApps[app].route;
    if (Date.now() >= pending.expiresAt) return fail("expired");
    if (pending.memberLocator) {
      let personal: string;
      try {
        personal = await env.CHANNELS.getByName(
          pending.memberLocator,
        ).addMember(
          workspace.userId,
          workspace.teamId,
          app,
          pending.memberAccess!,
        );
      } catch {
        return fail("expired");
      }
      return redirect(`${frontendUrl.href}#/${route}/${personal}`, clear);
    }
    if (!pending.channelId) return fail("expired");
    const locator = await channelLocator(pending.channelId, app);
    const admin = randomHex(),
      requestSecret = randomHex();
    const [adminHash, requestHash] = await Promise.all([
      hashSecret(admin),
      hashSecret(requestSecret),
    ]);
    const requestCapability = `${locator}.${requestSecret}`;
    try {
      await env.CHANNELS.getByName(locator).bind(
        {
          app,
          locator,
          channelId: pending.channelId,
          teamId: workspace.teamId,
          ...(workspace.botUserId ? { botUserId: workspace.botUserId } : {}),
          adminHash,
          requestHash,
          requestCapability,
        },
        `${frontendUrl.href}#/${route}/${requestCapability}`,
      );
    } catch (error) {
      // RPC errors keep only their message: a fixed code from RequestError.
      return fail(
        error instanceof Error && error.message === "not_in_channel"
          ? "not_in_channel"
          : "unavailable",
      );
    }
    return redirect(
      `${frontendUrl.href}#/${route}-beheer/${locator}.${admin}/${requestCapability}`,
      clear,
    );
  } catch (error) {
    return fail(error instanceof LoginError ? error.reason : "unavailable");
  }
}
