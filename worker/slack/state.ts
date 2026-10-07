import { reactionVariant, themeFor, themes } from "../../shared/variant";
import type { CallOutcome } from "../channel/messages";
import { createSession } from "../../src/domain/drawEngine";
import { randomIndex } from "../../src/utils/random";
import type { WheelVariant } from "../../shared/variant";
import type { SlackReminderStatus } from "../../shared/protocol";
import type { StoredSession } from "../session";
import { RequestError } from "../session";
import { cookieName, type SlackPerson, type SlackSource } from "./source";
import { SlackApiClient, SlackError } from "./api";
export type ChannelNotice = "empty" | "unreadable";
/** Updates of a channel round's own call; repeating one is harmless. */
export const MAX_CARD_ATTEMPTS = 3;
/**
 * A settled channel round rewrites its call message in place, so the channel
 * keeps one message per round. Only the bot's own call is ever updated.
 */
export type CallCard = CallOutcome & {
  startAt: number;
  /** While the winner can be reviewed: the call invites to and links the round. */
  reviewUntil?: number;
  /** After the review closed: per winner, null when nobody reviewed them. */
  ratings?: ({ average: number; count: number } | null)[];
  status: "pending" | "updating" | "updated" | "failed";
  readyAt: number;
  attempts: number;
  attemptedAt?: number;
};
export interface SlackJob {
  drawId: string;
  source: SlackSource;
  names: string[];
  /** Private, frozen in winner order; absent on jobs created before mentions shipped. */
  mentionIds?: (string | null)[];
  /** Koekrad only: per winner, the reactor whose nomination ticket won, or null. */
  sponsorIds?: (string | null)[];
  /** Host-started sessions with reviews: the invitation under the winners. */
  review?: { until: number; link: string };
  /** Koekrad rounds only: the round's validated word. */
  title?: string;
  status: "pending" | "posting" | "posted" | "failed" | "uncertain";
  readyAt: number;
  attemptedAt?: number;
  retryAt?: number;
  postedMessageTs?: string;
}
/** Posted this long before a scheduled start; shorter plans post right away. */
export const REMINDER_LEAD_MS = 120000;
/** No reminder when less than this remains before the start. */
export const REMINDER_MIN_LEAD_MS = 30000;
/** Bounds thread messages a host can trigger by rescheduling. */
export const MAX_REMINDER_POSTS = 5;
export interface SlackReminder {
  id: string;
  startAt: string;
  readyAt: number;
  /**
   * Raw spectator capability, verified against the stored hash. Kept only while
   * a post is still possible and deleted as soon as the reminder settles.
   */
  capability?: string;
  status: SlackReminderStatus;
  attempts: number;
  attemptedAt?: number;
  retryAt?: number;
}
export interface SlackState {
  grantHash: string;
  grantExpiresAt?: number;
  source?: SlackSource;
  mapping: Record<string, string>;
  /**
   * Koekrad only, private and temporary: per participant ID, the reactors whose
   * `:naam-koek:` made that participant's slice bigger, one ticket each.
   */
  cookieSponsors?: Record<string, string[]>;
  /** Legacy extra entries of rounds started before slices were weighted. */
  cookieEntries?: Record<string, { id: string }>;
  syncedAt?: string;
  count?: number;
  importing?: { id: string; until: number };
  nextImportAt?: number;
  nextFinalImportAt?: number;
  retryImportAt?: number;
  job?: SlackJob;
  /** Channel rounds only: the pending rewrite of the call message. */
  card?: CallCard;
  reminder?: SlackReminder;
  reminderPosts?: number;
  /** Started by a channel-bound Koffierad: no host, refreshes itself until the draw. */
  channelRound?: boolean;
  /** Private: the bot's own user, whose prefilled reaction never counts. */
  excludeUserIds?: string[];
}
/** Participant ID to Slack ID; nominations never add identities. */
export function participantSlackIds(state: SlackState): Map<string, string> {
  return new Map(
    Object.entries(state.mapping).map(([slackId, id]) => [id, slackId]),
  );
}
/** Stable opaque identity; numbered display labels distinguish equal names without Slack IDs. */
export function reconcile(
  record: StoredSession,
  source: SlackSource,
  people: SlackPerson[],
  now: number,
) {
  const state = record.slack!;
  const oldIds = new Set([
    ...Object.values(state.mapping),
    ...Object.values(state.cookieEntries ?? {}).map((e) => e.id),
  ]);
  const manual = record.session.participants.filter((p) => !oldIds.has(p.id));
  const used = new Set(manual.map((p) => p.name.toLocaleLowerCase("nl")));
  const mapping: Record<string, string> = {};
  const own = people.filter((p) => !p.cookieReaction);
  const sponsors: Record<string, string[]> = {};
  if (source.reactionName === "cookie") {
    const seen = new Set<string>();
    for (const p of people.filter((p) => p.cookieReaction)) {
      const name = cookieName(p.cookieReaction);
      if (!name) throw new RequestError(400, "slack_response");
      const key = `${p.cookieReaction}:${p.slackId}`;
      if (seen.has(key)) throw new RequestError(400, "slack_response");
      seen.add(key);
      // Only the unique exact name match among actual cookie signups, before
      // display suffixes; missing or ambiguous names are ignored.
      const matches = own.filter((person) =>
        person.name.toLocaleLowerCase("nl") === name.toLocaleLowerCase("nl"));
      if (matches.length === 1)
        (sponsors[matches[0].slackId] ??= []).push(p.slackId);
    }
  }
  const cookieSponsors: Record<string, string[]> = {};
  const imported = own.map((p) => {
    const id = state.mapping[p.slackId] ?? crypto.randomUUID();
    mapping[p.slackId] = id;
    let name = p.name;
    let suffix = 1;
    while (used.has(name.toLocaleLowerCase("nl"))) {
      const label = ` (${++suffix})`;
      name = p.name.slice(0, 32 - label.length).trimEnd() + label;
    }
    used.add(name.toLocaleLowerCase("nl"));
    const extra = sponsors[p.slackId];
    if (!extra) return { id, name };
    cookieSponsors[id] = extra.sort();
    return { id, name, weight: 1 + extra.length };
  });
  if (manual.length + imported.length > 100)
    throw new RequestError(400, "slack_too_many");
  record.session = createSession(
    record.session.id,
    [...manual, ...imported],
    record.preferredCount,
  );
  state.source = source;
  state.mapping = mapping;
  if (Object.keys(cookieSponsors).length) state.cookieSponsors = cookieSponsors;
  else delete state.cookieSponsors;
  delete state.cookieEntries;
  state.count = imported.length;
  state.syncedAt = new Date(now).toISOString();
}
export function queueResult(record: StoredSession) {
  const draw = record.session.activeDraw,
    slack = record.slack;
  if (!draw || !slack?.source) return;
  const identities = participantSlackIds(slack);
  // One ticket per slice unit, drawn once here as the draw starts: the
  // winner's own signup credits nobody, a nomination ticket its reactor.
  const sponsorOf = (winnerId: string) => {
    const sponsors = slack.cookieSponsors?.[winnerId] ?? [];
    const ticket = sponsors.length ? randomIndex(1 + sponsors.length) : 0;
    return ticket ? sponsors[ticket - 1] : null;
  };
  slack.job = {
    drawId: draw.id,
    source: { ...slack.source },
    names: draw.spins.map(
      (spin) =>
        record.session.participants.find((p) => p.id === spin.winnerId)!.name,
    ),
    mentionIds: draw.spins.map((spin) => identities.get(spin.winnerId) ?? null),
    ...(slack.source.reactionName === "cookie" ? {
      sponsorIds: draw.spins.map((spin) => sponsorOf(spin.winnerId)),
    } : {}),
    ...(record.title ? { title: record.title } : {}),
    status: "pending",
    readyAt: Math.max(
      ...draw.spins.map((s) => Date.parse(s.startAt) + s.durationMs),
    ),
  };
  if (slack.channelRound && record.scheduledDraw)
    slack.card = {
      kind: "winner",
      names: [...slack.job.names],
      mentionIds: [...slack.job.mentionIds!],
      participants: draw.participantIds.length,
      startAt: Date.parse(record.scheduledDraw.startAt),
      status: "pending",
      readyAt: slack.job.readyAt,
      attempts: 0,
    };
}
/** A channel round that ended without a draw says so in its call, not in a thread. */
export function queueChannelNotice(
  record: StoredSession,
  notice: ChannelNotice,
  now: number,
) {
  const slack = record.slack;
  if (!slack?.channelRound || !slack.source || !record.scheduledDraw) return;
  slack.card = {
    kind: notice,
    startAt: Date.parse(record.scheduledDraw.startAt),
    status: "pending",
    readyAt: now,
    attempts: 0,
  };
}
export function resultBody(job: SlackJob) {
  const theme = themeFor(reactionVariant(job.source.reactionName), job.title);
  const heading = `${theme.icon} Het rad heeft gesproken!\n`;
  const ending = `${job.names.length === 1 ? "Jij mag" : "Jullie mogen"} ${theme.drink} halen!`;
  const invitation = job.review
    ? `\n⭐ Beoordeel de ${job.names.length === 1 ? "haler" : "halers"} tot ${clock.format(job.review.until)}: `
    : "";
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // Only server-resolved identities become mentions. Names remain literal text.
  const ids = job.names.map((_, index) => {
    const id = job.mentionIds?.[index];
    return id && /^[UW][A-Z0-9]{8,20}$/.test(id) && id !== "USLACKBOT"
      ? id
      : null;
  });
  const sponsors = job.names.map((_, index) => {
    const id = job.source.reactionName === "cookie" ? job.sponsorIds?.[index] : null;
    return id && /^[UW][A-Z0-9]{8,20}$/.test(id) && id !== "USLACKBOT" ? id : null;
  });
  const credit = sponsors.filter((id): id is string => !!id)
    .map((id) => `\nMede mogelijk gemaakt door... <@${id}>`).join("");
  // Slack derives notifications from the fallback text, so the same frozen
  // identities appear there as <@U…>; everything else is escaped.
  const text = `${escape(heading)}${job.names
    .map((name, index) => (ids[index] ? `<@${ids[index]}>` : escape(name)))
    .join(" · ")}${escape(`\n${ending}`)}${credit}${escape(`${invitation}${job.review?.link ?? ""}`)}`;
  const elements: (
    | { type: "text"; text: string }
    | { type: "user"; user_id: string }
    | { type: "link"; url: string; text: string }
  )[] = [{ type: "text", text: heading }];
  job.names.forEach((name, index) => {
    if (index) elements.push({ type: "text", text: " · " });
    const id = ids[index];
    elements.push(
      id ? { type: "user", user_id: id } : { type: "text", text: name },
    );
  });
  elements.push({
    type: "text",
    text: `\n${ending}`,
  });
  for (const id of sponsors)
    if (id) elements.push(
      { type: "text", text: "\nMede mogelijk gemaakt door... " },
      { type: "user", user_id: id },
    );
  // The join link is server-built from FRONTEND_URL, never client text.
  if (job.review)
    elements.push(
      { type: "text", text: invitation },
      { type: "link", url: job.review.link, text: "Open de ronde" },
    );
  return {
    channel: job.source.channelId,
    thread_ts: job.source.parentMessageTs,
    text,
    blocks: [
      {
        type: "rich_text",
        elements: [{ type: "rich_text_section", elements }],
      },
    ],
    mrkdwn: false,
    parse: "none",
    link_names: false,
    // Channel rounds show the winner in their updated call instead.
    reply_broadcast: false,
    unfurl_links: false,
    unfurl_media: false,
  };
}
type PostOutcome =
  | { status: "posted"; postedMessageTs: string }
  | { status: "failed" | "uncertain"; retryAt: number };
export async function postMessage(
  api: SlackApiClient,
  channelId: string,
  body: Record<string, unknown>,
): Promise<PostOutcome> {
  try {
    const result = await api.call("chat.postMessage", body);
    if (
      result.channel !== channelId ||
      typeof result.ts !== "string" ||
      !/^\d{10}\.\d{6}$/.test(result.ts)
    )
      throw new SlackError("slack_response", 60000, true);
    return { status: "posted", postedMessageTs: result.ts };
  } catch (error) {
    return {
      status:
        error instanceof SlackError && !error.uncertain
          ? "failed"
          : "uncertain",
      retryAt:
        Date.now() + (error instanceof SlackError ? error.retryAfterMs : 60000),
    };
  }
}
/** Rewrites one of the bot's own messages; the response must name that message. */
export async function updateMessage(
  api: SlackApiClient,
  body: { channel: string; ts: string } & Record<string, unknown>,
): Promise<{ status: "updated" } | { status: "failed"; retryAt: number }> {
  try {
    const result = await api.call("chat.update", body);
    if (result.channel !== body.channel || result.ts !== body.ts)
      throw new SlackError("slack_response");
    return { status: "updated" };
  } catch (error) {
    return {
      status: "failed",
      retryAt:
        Date.now() + (error instanceof SlackError ? error.retryAfterMs : 60000),
    };
  }
}
export function postResult(
  api: SlackApiClient,
  job: SlackJob,
): Promise<PostOutcome> {
  return postMessage(api, job.source.channelId, resultBody(job));
}
export const clock = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
});
/** Fixed text plus one server-built link; no names, mentions or client text. */
export function reminderBody(
  source: SlackSource,
  variant: WheelVariant,
  link: string,
  startAt: string,
  now: number,
  /** With reviews: the session's join link, to watch or log in. */
  join = false,
) {
  const theme = themes[variant];
  const minutes = Math.max(1, Math.round((Date.parse(startAt) - now) / 60000));
  const heading = `⏰ Over ${minutes} ${minutes === 1 ? "minuut" : "minuten"} (${clock.format(Date.parse(startAt))}) draait het ${theme.name}! ${theme.icon}
${join ? "Kijk live mee, of log in om na afloop de halers te beoordelen: " : "Kijk live mee: "}`;
  const label = join ? "Open de ronde" : "Open het rad";
  const escape = (text: string) =>
    text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    channel: source.channelId,
    thread_ts: source.parentMessageTs,
    text: escape(`${heading}${link}`),
    blocks: [
      {
        type: "rich_text",
        elements: [
          {
            type: "rich_text_section",
            elements: [
              { type: "text", text: heading },
              { type: "link", url: link, text: label },
            ],
          },
        ],
      },
    ],
    mrkdwn: false,
    parse: "none",
    link_names: false,
    reply_broadcast: false,
    unfurl_links: false,
    unfurl_media: false,
  };
}
export function postReminder(
  api: SlackApiClient,
  body: ReturnType<typeof reminderBody>,
): Promise<PostOutcome> {
  return postMessage(api, body.channel, body);
}
