import { object, SlackApiClient, SlackError } from "./api";
export interface SlackSource {
  channelId: string;
  parentMessageTs: string;
  reactionName: "beers";
}
const timestamp = /^\d{10}\.\d{6}$/;
const channel = /^[CG][A-Z0-9]{8,20}$/;
export function parseSlackPermalink(raw: unknown): SlackSource {
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
    reactionName: "beers",
  };
}
export interface SlackPerson {
  slackId: string;
  name: string;
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
  async getParticipants(source: SlackSource): Promise<SlackPerson[]> {
    if (
      !channel.test(source.channelId) ||
      !timestamp.test(source.parentMessageTs) ||
      source.reactionName !== "beers"
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
      const matches = reactions.map(object).filter((r) => r.name === "beers");
      if (matches.length > 1) throw new SlackError("slack_response");
      if (!matches.length) return [];
      const r = matches[0];
      if (
        !Array.isArray(r.users) ||
        r.users.some(
          (id) =>
            typeof id !== "string" ||
            !/^(?:[UW][A-Z0-9]{8,20}|USLACKBOT)$/.test(id),
        ) ||
        !Number.isSafeInteger(r.count) ||
        Number(r.count) < 0
      )
        throw new SlackError("slack_response");
      const ids = [...new Set(r.users as string[])].sort();
      if (ids.length !== r.count) throw new SlackError("slack_incomplete");
      if (ids.length > 100) throw new SlackError("slack_too_many");
      const result: SlackPerson[] = [];
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, ids.length) }, async () => {
          while (cursor < ids.length) {
            const id = ids[cursor++];
            if (id === "USLACKBOT") continue;
            const response = await this.api.call(
              "users.info",
              { user: id },
              controller.signal,
            );
            const user = object(response.user);
            if (
              user.id !== id ||
              typeof user.deleted !== "boolean" ||
              typeof user.is_bot !== "boolean"
            )
              throw new SlackError("slack_response");
            if (user.deleted || user.is_bot || user.is_app_user === true)
              continue;
            const profile = object(user.profile);
            const name =
              displayName(profile.display_name) ??
              displayName(profile.real_name) ??
              displayName(user.real_name) ??
              "Deelnemer";
            result.push({ slackId: id, name });
          }
        }),
      );
      return result.sort((a, b) => a.slackId.localeCompare(b.slackId));
    } finally {
      controller.abort();
      clearTimeout(timeout);
    }
  }
}
