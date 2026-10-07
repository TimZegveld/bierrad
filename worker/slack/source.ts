import { themes, wheelVariants, type SlackReaction } from "../../shared/variant";
import { object, SlackApiClient, SlackError } from "./api";
export interface SlackSource {
  channelId: string;
  parentMessageTs: string;
  reactionName: SlackReaction;
}
const timestamp = /^\d{10}\.\d{6}$/;
const channel = /^[CG][A-Z0-9]{8,20}$/;
export function parseSlackPermalink(
  raw: unknown,
  reactionName: SlackSource["reactionName"] = "beers",
): SlackSource {
  if (
    typeof raw !== "string" ||
    raw.length > 1024 ||
    raw !== raw.trim() ||
    raw.includes("/../") ||
    raw.includes("/./") ||
    /[%\\\s]/.test(raw)
  )
    throw new SlackError("slack_link");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SlackError("slack_link");
  }
  const match = /^\/archives\/([CG][A-Z0-9]{8,20})\/p(\d{10})(\d{6})$/.exec(
    url.pathname,
  );
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    !/^[a-z0-9][a-z0-9-]*\.slack\.com$/.test(url.hostname) ||
    !match
  )
    throw new SlackError("slack_link");
  const keys = [...url.searchParams.keys()];
  if (
    new Set(keys).size !== keys.length ||
    keys.some((k) => !["thread_ts", "cid"].includes(k))
  )
    throw new SlackError("slack_link");
  const parent = url.searchParams.get("thread_ts");
  if (
    (parent && !timestamp.test(parent)) ||
    (url.searchParams.has("thread_ts") && !parent) ||
    (url.searchParams.has("cid") && url.searchParams.get("cid") !== match[1])
  )
    throw new SlackError("slack_link");
  return {
    channelId: match[1],
    parentMessageTs: parent ?? `${match[2]}.${match[3]}`,
    reactionName,
  };
}
export interface SlackPerson {
  slackId: string;
  name: string;
  /** Extra Koekrad entry sponsored by this reactor, not their own signup. */
  cookieReaction?: string;
}
/** Emoji names become literal labels only; underscores represent spaces. */
export function cookieName(reaction: unknown): string | undefined {
  if (typeof reaction !== "string") return;
  const match = /^([a-z][a-z_-]{0,31})-koek$/.exec(reaction);
  if (!match || !/^[a-z]+(?:[_-][a-z]+)*$/.test(match[1])) return;
  return match[1].replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
export function displayName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return;
  const name = raw
    .normalize("NFKC")
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g,
      "",
    )
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 32)
    .trim();
  // Never fall back to email-like fields or expose an address as a display name.
  return name && !name.includes("@") ? name : undefined;
}
export class SlackReactionParticipantSource {
  constructor(private api: SlackApiClient) {}
  /** `exclude` holds private IDs that never count, such as the bot's own prefilled reaction. */
  async getParticipants(
    source: SlackSource,
    exclude: readonly string[] = [],
  ): Promise<SlackPerson[]> {
    if (
      !channel.test(source.channelId) ||
      !timestamp.test(source.parentMessageTs) ||
      !wheelVariants.some((v) => themes[v].reaction === source.reactionName)
    )
      throw new SlackError("slack_link");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const data = await this.api.call(
        "reactions.get",
        {
          channel: source.channelId,
          timestamp: source.parentMessageTs,
          full: true,
        },
        controller.signal,
      );
      const message = object(data.message);
      if (
        data.type !== "message" ||
        data.channel !== source.channelId ||
        message.ts !== source.parentMessageTs ||
        (message.thread_ts !== undefined && message.thread_ts !== message.ts)
      )
        throw new SlackError("slack_response");
      const reactions = message.reactions ?? [];
      if (!Array.isArray(reactions)) throw new SlackError("slack_response");
      const matches = reactions
        .map(object)
        .filter(
          (r) => r.name === source.reactionName ||
            (source.reactionName === "cookie" && cookieName(r.name)),
        );
      if (new Set(matches.map((r) => r.name)).size !== matches.length)
        throw new SlackError("slack_response");
      const entries = matches.flatMap((r) => {
        if (
          !Array.isArray(r.users) ||
          r.users.some(
            (id) => typeof id !== "string" ||
              !/^(?:[UW][A-Z0-9]{8,20}|USLACKBOT)$/.test(id),
          ) ||
          !Number.isSafeInteger(r.count) ||
          Number(r.count) < 0
        ) throw new SlackError("slack_response");
        const users = [...new Set(r.users as string[])].sort();
        if (users.length !== r.count) throw new SlackError("slack_incomplete");
        return users.map((id) => ({ id, reaction: String(r.name) }));
      });
      if (entries.length > 100) throw new SlackError("slack_too_many");
      const ids = [...new Set(entries.map((e) => e.id))].sort();
      const people = new Map<string, SlackPerson>();
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, ids.length) }, async () => {
          while (cursor < ids.length) {
            const id = ids[cursor++];
            if (id === "USLACKBOT" || exclude.includes(id)) continue;
            const response = await this.api.call(
              "users.info",
              { user: id },
              controller.signal,
            );
            const user = object(response.user);
            // External Slack Connect users ("strangers") arrive as a reduced
            // object without deleted/is_bot/profile; absent flags mean false.
            const flag = (value: unknown) =>
              value === undefined || typeof value === "boolean";
            if (
              user.id !== id ||
              !flag(user.deleted) ||
              !flag(user.is_bot) ||
              !flag(user.is_app_user)
            )
              throw new SlackError("slack_response");
            if (user.deleted || user.is_bot || user.is_app_user) continue;
            const profile =
              user.profile === undefined ? {} : object(user.profile);
            const name =
              displayName(profile.display_name) ??
              displayName(profile.real_name) ??
              displayName(user.real_name) ??
              "Deelnemer";
            people.set(id, { slackId: id, name });
          }
        }),
      );
      return entries
        .filter((e) => people.has(e.id))
        .sort((a, b) => a.reaction.localeCompare(b.reaction) || a.id.localeCompare(b.id))
        .map((e) => e.reaction === source.reactionName
          ? people.get(e.id)!
          : { slackId: e.id, name: cookieName(e.reaction)!, cookieReaction: e.reaction });
    } finally {
      controller.abort();
      clearTimeout(timeout);
    }
  }
}
