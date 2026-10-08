import {
  channelApps,
  channelCopy,
  type ChannelApp,
  type ChannelVariant,
} from "../../shared/channel";
import { roundTitle, themes } from "../../shared/variant";
import { equalHash, hashSecret } from "../auth";
import { MAX_INTRO_LENGTH, parseBeerText } from "./beer";
/**
 * Slash commands. `/koffierad`, `/waterrad` and `/koekrad` belong to the
 * Koffierad app, `/bierrad` to the Bierrad app. Each app has its own endpoint
 * and signing secret, the only authorization, and accepts only its own commands.
 * https://docs.slack.dev/authentication/verifying-requests-from-slack/
 */
function commandVariant(
  command: string | undefined,
  app: ChannelApp,
): ChannelVariant | undefined {
  return channelApps[app].variants.find(
    (v) => channelCopy[v].command === command,
  );
}
const MAX_BODY_BYTES = 8192;
/** Koffierad commands take a number and one word; `/bierrad` also its own text. */
const MAX_TEXT: Record<ChannelApp, number> = { coffee: 32, beer: 2000 };
const MAX_SKEW_S = 300;

export class SlashError extends Error {}
/** Reads the raw form body with a byte bound; the signature covers these exact bytes. */
export async function readSlashBody(request: Request): Promise<string> {
  if (
    request.method !== "POST" ||
    !request.headers
      .get("Content-Type")
      ?.startsWith("application/x-www-form-urlencoded")
  )
    throw new SlashError("invalid");
  const reader = request.body?.getReader();
  if (!reader) throw new SlashError("invalid");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new SlashError("invalid");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
    all,
  );
}
export async function verifySlackSignature(
  secret: string | undefined,
  headers: Headers,
  body: string,
  now = Date.now(),
): Promise<boolean> {
  if (!secret) return false;
  const timestamp = headers.get("X-Slack-Request-Timestamp") ?? "";
  const signature = headers.get("X-Slack-Signature") ?? "";
  if (
    !/^\d{1,12}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > MAX_SKEW_S ||
    !/^v0=[a-f0-9]{64}$/.test(signature)
  )
    return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`v0:${timestamp}:${body}`),
  );
  const expected =
    "v0=" +
    Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
  // Compare digests of equal length so timing reveals nothing about the MAC.
  return equalHash(await hashSecret(expected), await hashSecret(signature));
}
export type SlashRequest =
  | { kind: "help"; variant: ChannelVariant }
  | { kind: "invalid" }
  | { kind: "wrongChannel"; variant: ChannelVariant }
  /** `/bierrad` at a time that has passed, too far ahead, or with too much text. */
  | { kind: "refused"; variant: ChannelVariant; reason: "past" | "far" | "intro" }
  | {
      kind: "round";
      variant: ChannelVariant;
      channelId: string;
      userId: string;
      minutes?: number;
      /** Signed by Slack like everything else; only shown, never authorizes. */
      channelName?: string;
      /** `/koekrad <titel>` only, validated by `roundTitle`; only shown. */
      title?: string;
      /** `/bierrad` only: the chosen start; other rounds start after minutes. */
      startAt?: number;
      /** `/bierrad` only, when the command names a number of winners. */
      winners?: number;
      /** `/bierrad` only: own text above the call, cleaned by `cleanIntro`; only shown. */
      intro?: string;
    };
/** Slack channel names: lowercase letters, digits, `-`, `_` and `.`, at most 80. */
export function validChannelName(name: string | undefined): string | undefined {
  return name &&
    /^[a-z0-9][a-z0-9._-]{0,79}$/.test(name) &&
    !["privategroup", "directmessage"].includes(name) &&
    !name.startsWith("mpdm-")
    ? name
    : undefined;
}
export function parseSlashCommand(
  body: string,
  app: ChannelApp = "coffee",
  now = Date.now(),
): SlashRequest {
  const params = new URLSearchParams(body);
  const one = (key: string) =>
    params.getAll(key).length === 1 ? params.get(key)! : undefined;
  const userId = one("user_id");
  const channelId = one("channel_id");
  const raw = one("text") ?? "";
  const text = raw.trim();
  const variant = commandVariant(one("command"), app);
  if (
    !variant ||
    !userId ||
    !/^[UW][A-Z0-9]{8,20}$/.test(userId) ||
    !channelId ||
    channelId.length > 32 ||
    raw.length > MAX_TEXT[app]
  )
    return { kind: "invalid" };
  if (!/^[CG][A-Z0-9]{8,20}$/.test(channelId))
    return { kind: "wrongChannel", variant };
  if (/^(help|hulp|\?)$/i.test(text)) return { kind: "help", variant };
  const channelName = validChannelName(one("channel_name"));
  const round = {
    kind: "round",
    variant,
    channelId,
    userId,
    ...(channelName ? { channelName } : {}),
  } as const;
  if (variant === "beer") {
    const beer = parseBeerText(raw, now);
    if (!beer.ok)
      return beer.reason === "help"
        ? { kind: "help", variant }
        : { kind: "refused", variant, reason: beer.reason };
    return {
      ...round,
      startAt: beer.startAt,
      ...(beer.winners !== undefined ? { winners: beer.winners } : {}),
      ...(beer.intro ? { intro: beer.intro } : {}),
    };
  }
  if (!text) return round;
  // Minutes come last; only the Koekrad takes one word before them.
  const match = /(?:^|\s+)(\d{1,2})\s*(m|min|minuut|minuten)?$/i.exec(text);
  const rest = match ? text.slice(0, match.index) : text;
  const title = variant === "cookie" && rest ? roundTitle(rest) : undefined;
  if (rest && !title) return { kind: "help", variant };
  return {
    ...round,
    ...(match ? { minutes: Number(match[1]) } : {}),
    ...(title ? { title } : {}),
  };
}
/** Only the person who typed the command sees this reply. */
export function ephemeral(text: string): Response {
  return Response.json(
    { response_type: "ephemeral", text },
    {
      headers: {
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
export function slashHelp(variant: ChannelVariant): string {
  const { command, round } = channelCopy[variant];
  if (variant === "beer")
    return `${themes.beer.icon} Gebruik \`${command}\` voor een ${round} vandaag om 15.45, of bijvoorbeeld \`${command} 16.00\`, \`${command} vrijdag 15.45 3\` (drie halers) of \`${command} 10-10 16.30\`. Wat erachter komt, staat als eigen tekst boven de oproep: emoji en *vet* mogen, tot ${MAX_INTRO_LENGTH} tekens.`;
  return variant === "cookie"

    ? `${themes[variant].icon} Gebruik \`${command}\` om een ${round} te starten met de standaardwachttijd van dit kanaal, of bijvoorbeeld \`${command} taart 10\` voor een taartronde na 1 tot 30 minuten. De titel is één woord van 2 tot 20 letters.`
    : `${themes[variant].icon} Gebruik \`${command}\` om een ${round} te starten met de standaardwachttijd van dit kanaal, of \`${command} 10\` om het rad na 1 tot 30 minuten te laten draaien.`;
}
