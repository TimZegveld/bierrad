import { isStandaloneVariant, themes } from "../shared/variant";
import type { WheelVariant } from "../shared/variant";
import type { CreatedSession } from "../shared/protocol";
import { type SlackSecrets } from "./slack/access";
import { slackAuth } from "./slack/routes";
import { creationAllowed } from "./limits";
import {
  randomHex,
  randomWords,
  parseCapability,
  capabilityLocator,
  hashSecret,
  wordLocator,
} from "./auth";
import { json, readBody } from "./http";
import { RequestError } from "./session";
import {
  channelApps,
  channelCopy,
  roundCopy,
  validRoundMinutes,
  type ChannelApp,
} from "../shared/channel";
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

type WorkerEnv = Env & SlackSecrets;
async function createSession(
  env: WorkerEnv,
  variant: WheelVariant,
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
    variant,
  );
  return {
    hostCapability: `${locator}.${host}`,
    spectatorCapability: spectator,
    expiresAt,
  };
}
/** Ephemeral replies for a `/bierrad` that cannot start at the chosen time. */
const refusals = {
  past: "Dat tijdstip is al geweest (of is binnen een minuut). Kies een latere tijd, of een dag erbij: bijvoorbeeld `/bierrad morgen 15.45`.",
  far: "Zo ver vooruit kan niet: plan een bierronde hooguit 30 dagen vooruit.",
  intro: "Je eigen tekst is te lang: hooguit 500 tekens en 8 regels.",
} as const;
/**
 * Slash commands from Slack. Server-to-server: no Origin or capability,
 * authorized solely by the request signature of the app the endpoint belongs
 * to: `/slack/commands` for the Koffierad (`/koffierad`, `/waterrad`,
 * `/koekrad`), `/slack/bier-commands` for the Bierrad (`/bierrad`).
 */
async function slashCommand(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
  app: ChannelApp,
): Promise<Response> {
  try {
    const body = await readSlashBody(request);
    // Slack's certificate check carries no command; answer without acting.
    if (new URLSearchParams(body).get("ssl_check") === "1")
      return new Response(null, { status: 200 });
    if (
      !(await verifySlackSignature(
        app === "beer"
          ? env.SLACK_SIGNING_SECRET
          : env.COFFEE_SLACK_SIGNING_SECRET,
        request.headers,
        body,
      ))
    )
      return json({ code: "forbidden" }, 401);
    const command = parseSlashCommand(body, app);
    if (command.kind === "invalid") return json({ code: "invalid" }, 400);
    const icon = themes[command.variant].icon;
    const own = channelApps[app];
    if (command.kind === "wrongChannel")
      return ephemeral(
        `${icon} Gebruik ${channelCopy[command.variant].command} in een kanaal waar het ${own.name} aan gekoppeld is.`,
      );
    if (command.kind === "refused")
      return ephemeral(`${icon} ${refusals[command.reason]}`);
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
      return ephemeral(`${icon} Even rustig aan. Probeer het over een minuut opnieuw.`);
    // Coffee, water and cookie share the channel's Koffierad binding and its
    // round limits; the Bierrad has its own binding.
    const work = env.CHANNELS.getByName(
      await channelLocator(command.channelId, app),
    ).slash({
      variant: command.variant,
      ...(command.minutes !== undefined ? { minutes: command.minutes } : {}),
      ...(command.channelName ? { channelName: command.channelName } : {}),
      ...(command.title ? { title: command.title } : {}),
      ...(command.startAt !== undefined ? { startAt: command.startAt } : {}),
      ...(command.winners !== undefined ? { winners: command.winners } : {}),
      ...(command.intro ? { intro: command.intro } : {}),
    });
    // Slack waits about three seconds; the round continues after we answer.
    ctx.waitUntil(work.catch(() => undefined));
    const reply = await Promise.race([
      work.catch(
        () => `${icon} Het ${own.name} is nu niet bereikbaar. Probeer het zo opnieuw.`,
      ),
      new Promise<string>((resolve) =>
        setTimeout(
          () =>
            resolve(
              `${icon} De ${roundCopy(command.variant, command.title).round} wordt aangevraagd. Kijk zo in het kanaal.`,
            ),
          2500,
        ),
      ),
    ]);
    // An empty 200 shows nothing in Slack: the call in the channel says enough.
    return reply === null ? new Response(null, { status: 200 }) : ephemeral(reply);
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
      return slashCommand(request, env, ctx, "coffee");
    if (url.pathname === "/slack/bier-commands")
      return slashCommand(request, env, ctx, "beer");
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
            // Water exists only as a channel round, never as an own session.
            ("variant" in body && !isStandaloneVariant(body.variant))
          )
            throw new RequestError(400, "invalid");
          const variant =
            "variant" in body && isStandaloneVariant(body.variant)
              ? body.variant
              : "beer";
          response = json(await createSession(env, variant), 201);
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
            if (request.method !== "GET") throw new RequestError(405, "invalid");
            response = await env.CHANNELS.getByName(
              await channelViewerLocator(capability.secret),
            ).view(capability.secret);
          } else {
            const command =
              request.method === "POST" ? await readBody(request) : null;
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
