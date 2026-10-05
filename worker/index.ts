import { isWheelVariant, themes } from "../shared/variant";
import type { WheelVariant } from "../shared/variant";
import type { CreatedSession } from "../shared/protocol";
import {
  LOGIN_CEILING_MS,
  LOGIN_GRANT,
  slackEnvironment,
  type SlackSecrets,
} from "./slack/access";
import {
  beginLogin,
  completeLogin,
  loginCookie,
  LoginError,
  parseLoginCookie,
} from "./slack/login";
import {
  randomHex,
  randomWords,
  parseCapability,
  capabilityLocator,
  hashSecret,
  wordLocator,
} from "./auth";
import { frontend, json, readBody, redirect } from "./http";
import { RequestError } from "./session";
import { channelCopy, validRoundMinutes } from "../shared/channel";
import { channelLocator, channelViewerLocator } from "./channel/wheel";
import {
  ephemeral,
  parseSlashCommand,
  readSlashBody,
  slashHelp,
  verifySlackSignature,
} from "./channel/slash";
export { LiveSession } from "./live-session";
export { ChannelWheel } from "./channel/wheel";
export { Ratings } from "./ratings";

type WorkerEnv = Env & SlackSecrets;
/** Whether an offered capability opens the same session as the caller's. */
async function sameSession(
  offered: unknown,
  own: { locator: string | null; secret: string },
): Promise<boolean> {
  const parsed = typeof offered === "string" ? parseCapability(offered) : null;
  return (
    !!parsed &&
    (await capabilityLocator(parsed)) === (await capabilityLocator(own))
  );
}
async function createSession(
  env: WorkerEnv,
  variant: WheelVariant,
  grant?: { hash: string; expiresAt: number; teamId?: string },
): Promise<CreatedSession> {
  const spectator = randomWords(),
    locator = await wordLocator(spectator),
    host = randomHex();
  const [hostHash, spectatorHash] = await Promise.all([
    hashSecret(host),
    hashSecret(spectator),
  ]);
  const expiresAt = await env.SESSIONS.getByName(locator).initialize(
    hostHash,
    spectatorHash,
    grant,
    variant,
  );
  return {
    hostCapability: `${locator}.${host}`,
    spectatorCapability: spectator,
    expiresAt,
  };
}
async function creationAllowed(env: WorkerEnv, ip: string) {
  return (
    (await env.CREATION_LIMIT.limit({ key: ip })).success &&
    (await env.CREATION_GLOBAL.limit({ key: "creation" })).success
  );
}
/**
 * Top-level browser navigations for Sign in with Slack. These carry no Origin
 * header and the callback needs a query, so they bypass the API gate below and
 * only ever answer with redirects; capabilities go into the URL fragment only.
 */
async function slackAuth(
  request: Request,
  env: WorkerEnv,
  url: URL,
): Promise<Response> {
  const app = frontend(env);
  if (!app) return json({ code: "unavailable" }, 503);
  const callback = `${url.origin}/auth/slack/callback`;
  const pending = parseLoginCookie(request.headers.get("Cookie"));
  const named = /^\/auth\/slack\/([a-z]+)$/.exec(url.pathname);
  // `callback` and unknown names are not login starts.
  const start = named && isWheelVariant(named[1]) ? named : null;
  // Binding a Koffierad to a channel: the channel travels in the login cookie.
  const bindStart = /^\/auth\/slack\/channel\/([CG][A-Z0-9]{8,20})$/.exec(
    url.pathname,
  );
  let variant: WheelVariant = start
    ? (start[1] as WheelVariant)
    : bindStart
      ? "coffee"
      : (pending?.variant ?? "beer");
  const binding =
    !!bindStart ||
    (!start && url.pathname === "/auth/slack/callback" && !!pending?.channelId);
  const clear = loginCookie("", 0);
  const fail = (reason: string) =>
    redirect(
      pending?.rating || url.pathname === "/auth/slack/rating"
        ? `${app.href}#/rate-error/${variant}/${reason}`
        : binding
          ? `${app.href}#/koffie-koppelen/${reason}`
          : `${app.href}#/${variant === "beer" ? "" : `${variant}-`}slack/${reason}`,
      clear,
    );
  try {
    const ratingStart = url.pathname === "/auth/slack/rating";
    if (request.method !== (ratingStart ? "POST" : "GET"))
      return json({ code: "invalid" }, 405);
    const ip = request.headers.get("CF-Connecting-IP") ?? "local";
    if (!(await env.REQUEST_LIMIT.limit({ key: ip })).success)
      return fail("busy");
    if (ratingStart) {
      if (
        url.search ||
        !env.ALLOWED_ORIGINS.split(",").includes(
          request.headers.get("Origin") ?? "",
        ) ||
        !request.headers
          .get("Content-Type")
          ?.startsWith("application/x-www-form-urlencoded")
      )
        return fail("forbidden");
      const reader = request.body?.getReader();
      if (!reader) return fail("expired");
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 2048) {
            await reader.cancel();
            return fail("expired");
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
      const form = new URLSearchParams(new TextDecoder().decode(bytes));
      if (
        [...form.keys()].length !== 2 ||
        form.getAll("capability").length !== 1 ||
        form.getAll("drawId").length !== 1
      )
        return fail("expired");
      const cap = parseCapability(form.get("capability"));
      const drawId = form.get("drawId")!;
      if (
        !cap ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          drawId,
        )
      )
        return fail("expired");
      const locator = await capabilityLocator(cap);
      variant = await env.SESSIONS.getByName(locator).ratingLogin(
        cap.secret,
        drawId,
      );
      const login = beginLogin(
        slackEnvironment(env, variant),
        variant,
        callback,
        Date.now(),
        undefined,
        { locator, drawId },
      );
      return redirect(login.location, login.cookie);
    }
    if (start || bindStart) {
      if (url.search) return fail("expired");
      const login = beginLogin(
        slackEnvironment(env, variant),
        variant,
        callback,
        Date.now(),
        bindStart?.[1],
      );
      return redirect(login.location, login.cookie);
    }
    if (url.pathname !== "/auth/slack/callback") return fail("expired");
    if (!pending) return fail("expired");
    variant = pending.variant;
    // Before any Slack call: failed attempts also spend the creation budget.
    if (!pending.rating && !(await creationAllowed(env, ip)))
      return fail("busy");
    const workspace = await completeLogin(
      slackEnvironment(env, variant),
      pending,
      url.searchParams,
      callback,
    );
    if (pending.rating) {
      if (!workspace.userId) return fail("forbidden");
      const secret = await env.SESSIONS.getByName(
        pending.rating.locator,
      ).ratingGrant(pending.rating.drawId, workspace.teamId, workspace.userId);
      return redirect(
        `${app.href}#/rate/${pending.rating.locator}.${secret}`,
        clear,
      );
    }
    if (pending.channelId) {
      const locator = await channelLocator(pending.channelId);
      const admin = randomHex(),
        request = randomHex();
      const [adminHash, requestHash] = await Promise.all([
        hashSecret(admin),
        hashSecret(request),
      ]);
      const requestCapability = `${locator}.${request}`;
      try {
        await env.CHANNELS.getByName(locator).bind(
          {
            locator,
            channelId: pending.channelId,
            teamId: workspace.teamId,
            ...(workspace.botUserId ? { botUserId: workspace.botUserId } : {}),
            adminHash,
            requestHash,
            requestCapability,
          },
          `${app.href}#/koffie/${requestCapability}`,
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
        `${app.href}#/koffie-beheer/${locator}.${admin}/${requestCapability}`,
        clear,
      );
    }
    const created = await createSession(env, variant, {
      hash: LOGIN_GRANT,
      expiresAt: Date.now() + LOGIN_CEILING_MS,
      teamId: workspace.teamId,
    });
    return redirect(
      `${app.href}#/host/${created.hostCapability}/${created.spectatorCapability}`,
      clear,
    );
  } catch (error) {
    return fail(
      error instanceof LoginError
        ? error.reason
        : pending?.rating &&
            error instanceof Error &&
            error.message === "forbidden"
          ? "forbidden"
          : "unavailable",
    );
  }
}

/**
 * `/koffierad [minuten]` and `/waterrad [minuten]` from Slack. Server-to-server: no Origin or capability,
 * authorized solely by the Koffierad app's request signature.
 */
async function slashCommand(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  try {
    const body = await readSlashBody(request);
    // Slack's certificate check carries no command; answer without acting.
    if (new URLSearchParams(body).get("ssl_check") === "1")
      return new Response(null, { status: 200 });
    if (
      !(await verifySlackSignature(
        env.COFFEE_SLACK_SIGNING_SECRET,
        request.headers,
        body,
      ))
    )
      return json({ code: "forbidden" }, 401);
    const command = parseSlashCommand(body);
    if (command.kind === "invalid") return json({ code: "invalid" }, 400);
    const icon = themes[command.variant].icon;
    if (command.kind === "wrongChannel")
      return ephemeral(
        `${icon} Gebruik ${channelCopy[command.variant].command} in een kanaal waar het Koffierad aan gekoppeld is.`,
      );
    if (
      command.kind === "help" ||
      (command.minutes !== undefined && !validRoundMinutes(command.minutes))
    )
      return ephemeral(slashHelp(command.variant));
    const key = `slack:${command.userId}`;
    if (
      !(await env.REQUEST_LIMIT.limit({ key })).success ||
      !(await env.CREATION_LIMIT.limit({ key })).success ||
      !(await env.CREATION_GLOBAL.limit({ key: "creation" })).success
    )
      return ephemeral(
        `${icon} Even rustig aan. Probeer het over een minuut opnieuw.`,
      );
    // Coffee and water share the channel's one binding and its round limits.
    const work = env.CHANNELS.getByName(
      await channelLocator(command.channelId),
    ).slash(command.minutes, command.channelName, command.variant);
    // Slack waits about three seconds; the round continues after we answer.
    ctx.waitUntil(work.catch(() => undefined));
    const reply = await Promise.race([
      work.catch(
        () =>
          `${icon} Het Koffierad is nu niet bereikbaar. Probeer het zo opnieuw.`,
      ),
      new Promise<string>((resolve) =>
        setTimeout(
          () =>
            resolve(
              `${icon} De ${channelCopy[command.variant].round} wordt aangevraagd. Kijk zo in het kanaal.`,
            ),
          2500,
        ),
      ),
    ]);
    // An empty 200 shows nothing in Slack: the call in the channel says enough.
    return reply === null
      ? new Response(null, { status: 200 })
      : ephemeral(reply);
  } catch {
    return json({ code: "invalid" }, 400);
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowed = env.ALLOWED_ORIGINS.split(",");
    const url = new URL(request.url);
    if (url.pathname.startsWith("/auth/slack/"))
      return slackAuth(request, env, url);
    if (url.pathname === "/slack/commands")
      return slashCommand(request, env, ctx);
    let response: Response;
    try {
      if (!origin || !allowed.includes(origin))
        throw new RequestError(403, "forbidden");
      if (url.search) throw new RequestError(400, "invalid");
      if (request.method === "OPTIONS") {
        response = new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Max-Age": "600",
            "Cache-Control": "no-store",
          },
        });
      } else {
        const ip = request.headers.get("CF-Connecting-IP") ?? "local";
        if (!(await env.REQUEST_LIMIT.limit({ key: ip })).success)
          throw new RequestError(429, "rate_limited");
        if (url.pathname === "/api/sessions" && request.method === "POST") {
          if (!(await creationAllowed(env, ip)))
            throw new RequestError(429, "rate_limited");
          const body = await readBody(request);
          if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body) ||
            Object.keys(body).some((key) => key !== "variant") ||
            ("variant" in body && !isWheelVariant(body.variant))
          )
            throw new RequestError(400, "invalid");
          const variant =
            "variant" in body && isWheelVariant(body.variant)
              ? body.variant
              : "beer";
          response = json(await createSession(env, variant), 201);
        } else if (url.pathname === "/api/rating") {
          if (!["GET", "POST"].includes(request.method))
            throw new RequestError(405, "invalid");
          const cap = parseCapability(
            request.headers.get("Authorization")?.replace(/^Bearer /, "") ??
              null,
          );
          if (!cap?.locator) throw new RequestError(404, "unavailable");
          response = await env.SESSIONS.getByName(cap.locator).ratingAccess(
            cap.secret,
            request.method === "POST" ? await readBody(request) : null,
          );
        } else if (url.pathname === "/api/channel") {
          if (!["GET", "POST"].includes(request.method))
            throw new RequestError(405, "invalid");
          const capability = parseCapability(
            request.headers.get("Authorization")?.replace(/^Bearer /, "") ??
              null,
          );
          if (!capability) throw new RequestError(404, "unavailable");
          // Word links only watch a channel: no commands, ever.
          if (!capability.locator) {
            if (request.method !== "GET")
              throw new RequestError(405, "invalid");
            response = await env.CHANNELS.getByName(
              await channelViewerLocator(capability.secret),
            ).view(capability.secret);
          } else {
            const command =
              request.method === "POST" ? await readBody(request) : null;
            // A round creates a session: it spends the creation budget too.
            if (
              command &&
              typeof command === "object" &&
              "type" in command &&
              command.type === "requestRound" &&
              !(await creationAllowed(env, ip))
            )
              throw new RequestError(429, "rate_limited");
            response = await env.CHANNELS.getByName(capability.locator).access(
              capability.secret,
              command,
            );
          }
        } else if (
          ["/api/session", "/api/command", "/api/socket"].includes(url.pathname)
        ) {
          const socket = url.pathname === "/api/socket";
          if (
            socket || url.pathname === "/api/session"
              ? request.method !== "GET"
              : request.method !== "POST"
          )
            throw new RequestError(405, "invalid");
          const protocols =
            request.headers
              .get("Sec-WebSocket-Protocol")
              ?.split(",")
              .map((p) => p.trim()) ?? [];
          const raw = socket
            ? (protocols.find((p) => p.startsWith("auth."))?.slice(5) ?? null)
            : (request.headers.get("Authorization")?.replace(/^Bearer /, "") ??
              null);
          const capability = parseCapability(raw);
          if (!capability) throw new RequestError(404, "unavailable");
          const stub = env.SESSIONS.getByName(
            await capabilityLocator(capability),
          );
          if (socket) {
            if (
              request.headers.get("Upgrade")?.toLowerCase() !== "websocket" ||
              !protocols.includes("bierrad")
            )
              throw new RequestError(400, "invalid");
            response = await stub.fetch(request);
          } else {
            const command =
              url.pathname === "/api/command" ? await readBody(request) : null;
            // An offered spectator link must open this same session.
            if (
              command &&
              typeof command === "object" &&
              "spectatorCapability" in command &&
              !(await sameSession(command.spectatorCapability, capability))
            )
              throw new RequestError(400, "invalid");
            response = await stub.access(capability.secret, command);
          }
        } else throw new RequestError(404, "unavailable");
      }
    } catch (error) {
      response = json(
        { code: error instanceof RequestError ? error.code : "unavailable" },
        error instanceof RequestError ? error.status : 503,
      );
    }
    // Fetch/RPC responses may have immutable headers. Preserve the upgrade socket.
    response = new Response(response.body, {
      status: response.status,
      headers: new Headers(response.headers),
      ...(response.webSocket ? { webSocket: response.webSocket } : {}),
    });
    if (origin && allowed.includes(origin))
      response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Vary", "Origin");
    return response;
  },
} satisfies ExportedHandler<WorkerEnv>;
