import { randomHex, parseCapability, hashSecret } from "./auth";
import { json, readBody } from "./http";
import { RequestError } from "./session";
export { LiveSession } from "./live-session";

export default {
  async fetch(request, env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowed = env.ALLOWED_ORIGINS.split(",");
    let response: Response;
    try {
      if (!origin || !allowed.includes(origin))
        throw new RequestError(403, "forbidden");
      const url = new URL(request.url);
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
          if (
            !(await env.CREATION_LIMIT.limit({ key: ip })).success ||
            !(await env.CREATION_GLOBAL.limit({ key: "creation" })).success
          )
            throw new RequestError(429, "rate_limited");
          const body = await readBody(request);
          if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body) ||
            Object.keys(body).length
          )
            throw new RequestError(400, "invalid");
          const locator = randomHex(16),
            host = randomHex(),
            spectator = randomHex();
          const [hostHash, spectatorHash] = await Promise.all([
            hashSecret(host),
            hashSecret(spectator),
          ]);
          const expiresAt = await env.SESSIONS.getByName(locator).initialize(
            hostHash,
            spectatorHash,
          );
          response = json(
            {
              hostCapability: `${locator}.${host}`,
              spectatorCapability: `${locator}.${spectator}`,
              expiresAt,
            },
            201,
          );
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
          const stub = env.SESSIONS.getByName(capability.locator);
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
} satisfies ExportedHandler<Env>;
