import { isWheelVariant, type WheelVariant } from "../../shared/variant";
import { equalHash, randomHex } from "../auth";
import { object, SlackApiClient, SlackError, type SlackObject } from "./api";
import { loginConfigured, type SlackSecrets } from "./access";
/**
 * Sign in with Slack (OpenID Connect, authorization code flow).
 * Only decides whether a full workspace member may start a Slack session;
 * no Slack identity, token or profile is stored afterwards.
 */
export const LOGIN_COOKIE = "__Host-bierrad-slack-login";
export const LOGIN_TTL_MS = 10 * 60 * 1000;
export type LoginFailure = "denied" | "forbidden" | "expired" | "unavailable";
export class LoginError extends Error {
  constructor(public reason: LoginFailure) {
    super(reason);
  }
}
interface Pending {
  variant: WheelVariant;
  rating?: { locator: string; drawId: string };
  /** Set when the login binds a Koffierad to this channel instead of starting a session. */
  channelId?: string;
  state: string;
  nonce: string;
  expiresAt: number;
}
const team = /^T[A-Z0-9]{8,20}$/;
const user = /^[UW][A-Z0-9]{8,20}$/;

export function parseLoginCookie(
  header: string | null,
  now = Date.now(),
): Pending | undefined {
  const values = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${LOGIN_COOKIE}=`));
  // Duplicates are ambiguous; fail closed.
  if (values.length !== 1) return;
  const match =
    /^([a-z]+|channel-[CG][A-Z0-9]{8,20}|rating-(?:beer|coffee|water)-[a-f0-9]{32}-[a-f0-9-]{36})\.([a-f0-9]{64})\.([a-f0-9]{64})\.(\d{13})$/.exec(
      values[0].slice(LOGIN_COOKIE.length + 1),
    );
  if (!match || Number(match[4]) <= now) return;
  const rating =
    /^rating-(beer|coffee|water)-([a-f0-9]{32})-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(
      match[1],
    );
  if (!rating && !match[1].startsWith("channel-") && !isWheelVariant(match[1]))
    return;
  const channel = match[1].startsWith("channel-")
    ? match[1].slice(8)
    : undefined;
  return {
    // Channel binding is a Koffierad feature; it always uses the coffee app.
    variant: channel
      ? "coffee"
      : rating
        ? (rating[1] as WheelVariant)
        : (match[1] as WheelVariant),
    ...(rating ? { rating: { locator: rating[2], drawId: rating[3] } } : {}),
    ...(channel ? { channelId: channel } : {}),
    state: match[2],
    nonce: match[3],
    expiresAt: Number(match[4]),
  };
}
export function loginCookie(value: string, maxAge: number): string {
  return `${LOGIN_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
async function workspace(
  api: SlackApiClient,
): Promise<{ teamId: string; botUserId?: string }> {
  const data = await api.call("auth.test", {});
  if (typeof data.team_id !== "string" || !team.test(data.team_id))
    throw new SlackError("slack_response");
  return {
    teamId: data.team_id,
    ...(typeof data.user_id === "string" && user.test(data.user_id)
      ? { botUserId: data.user_id }
      : {}),
  };
}
/** No Slack call here: anyone can open this route, so it must not spend bot quota. */
export function beginLogin(
  env: SlackSecrets,
  variant: WheelVariant,
  redirectUri: string,
  now = Date.now(),
  channelId?: string,
  rating?: Pending["rating"],
): { location: string; cookie: string } {
  if (!loginConfigured(env)) throw new LoginError("unavailable");
  if (
    channelId !== undefined &&
    (variant !== "coffee" || !/^[CG][A-Z0-9]{8,20}$/.test(channelId))
  )
    throw new LoginError("expired");
  const state = randomHex(),
    nonce = randomHex();
  const location = new URL("https://slack.com/openid/connect/authorize");
  for (const [key, value] of Object.entries({
    response_type: "code",
    scope: "openid",
    client_id: env.SLACK_CLIENT_ID!,
    redirect_uri: redirectUri,
    state,
    nonce,
  }))
    location.searchParams.set(key, value);
  return {
    location: location.href,
    cookie: loginCookie(
      `${rating ? `rating-${variant}-${rating.locator}-${rating.drawId}` : channelId ? `channel-${channelId}` : variant}.${state}.${nonce}.${now + LOGIN_TTL_MS}`,
      LOGIN_TTL_MS / 1000,
    ),
  };
}
function claims(idToken: unknown): Record<string, unknown> {
  if (typeof idToken !== "string" || idToken.length > 8192)
    throw new LoginError("forbidden");
  const parts = idToken.split(".");
  if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1]))
    throw new LoginError("forbidden");
  try {
    const json = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return object(
      JSON.parse(
        new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0))),
      ),
    );
  } catch {
    throw new LoginError("forbidden");
  }
}
/**
 * Validates the callback; resolves only for allowed starters, with the bot's
 * workspace (never the person's identity).
 */
export async function completeLogin(
  env: SlackSecrets,
  pending: Pending,
  params: URLSearchParams,
  redirectUri: string,
  fetcher?: typeof fetch,
  now = Date.now(),
): Promise<{ teamId: string; botUserId?: string; userId?: string }> {
  const state = params.get("state");
  if (
    params.getAll("state").length !== 1 ||
    !state ||
    !/^[a-f0-9]{64}$/.test(state) ||
    !equalHash(state, pending.state)
  )
    throw new LoginError("expired");
  if (params.has("error")) throw new LoginError("denied");
  const code = params.get("code");
  if (
    params.getAll("code").length !== 1 ||
    !code ||
    !/^[A-Za-z0-9._-]{1,512}$/.test(code)
  )
    throw new LoginError("expired");
  if (!loginConfigured(env)) throw new LoginError("unavailable");
  let token: SlackObject;
  try {
    token = await new SlackApiClient("", fetcher).call("openid.connect.token", {
      client_id: env.SLACK_CLIENT_ID!,
      client_secret: env.SLACK_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
    });
  } catch {
    // Used, expired or foreign codes are all treated the same.
    throw new LoginError("expired");
  }
  try {
    // The ID token comes straight from Slack's token endpoint over TLS
    // (OIDC Core 3.1.3.7), so its claims are checked without a JWT library.
    const id = claims(token.id_token);
    const audience = Array.isArray(id.aud) ? id.aud : [id.aud];
    if (
      id.iss !== "https://slack.com" ||
      audience.length !== 1 ||
      audience[0] !== env.SLACK_CLIENT_ID ||
      typeof id.exp !== "number" ||
      id.exp * 1000 <= now ||
      typeof id.nonce !== "string" ||
      !equalHash(id.nonce, pending.nonce) ||
      typeof id.sub !== "string" ||
      !user.test(id.sub) ||
      (id["https://slack.com/user_id"] !== undefined &&
        id["https://slack.com/user_id"] !== id.sub)
    )
      throw new LoginError("forbidden");
    const claimedTeam = id["https://slack.com/team_id"];
    const bot = new SlackApiClient(env.SLACK_BOT_TOKEN!, fetcher);
    let bound: { teamId: string; botUserId?: string }, member: SlackObject;
    try {
      bound = await workspace(bot);
      member = object((await bot.call("users.info", { user: id.sub })).user);
    } catch {
      throw new LoginError("unavailable");
    }
    const teamId = bound.teamId;
    // Only full members of the bot's own workspace; no guests or external users.
    if (
      claimedTeam !== teamId ||
      member.id !== id.sub ||
      member.team_id !== teamId ||
      member.deleted !== false ||
      member.is_bot !== false ||
      member.is_app_user === true ||
      member.is_restricted === true ||
      member.is_ultra_restricted === true ||
      member.is_stranger === true
    )
      throw new LoginError("forbidden");
    // Only the separate rating flow receives a voter identity; ordinary login stays identity-free.
    return pending.rating ? { ...bound, userId: id.sub } : bound;
  } finally {
    // The user token is never needed; revoke it best-effort.
    if (typeof token.access_token === "string")
      await new SlackApiClient(token.access_token, fetcher)
        .call("auth.revoke", {})
        .catch(() => undefined);
  }
}
