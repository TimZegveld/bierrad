import { roundCopy, type ChannelVariant } from "../../shared/channel";
import { themeFor } from "../../shared/variant";
import { slackRating, type RatingEmoji } from "../slack/rating";
import { clock } from "../slack/state";

type Element =
  | { type: "text"; text: string; style?: { bold: true; italic?: true } }
  | { type: "link"; url: string; text: string }
  | { type: "user"; user_id: string }
  | RatingEmoji;

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Plain readable fallback for notifications; never parsed by Slack. */
const fallback = (elements: Element[], names: string[] = []) => {
  let name = 0;
  return escape(
    elements
      .map((e) =>
        e.type === "link"
          ? e.url
          : e.type === "user"
            ? names[name++]
            : e.type === "emoji"
              ? `:${e.name}:`
              : e.text,
      )
      .join(""),
  );
};
const options = {
  mrkdwn: false,
  parse: "none",
  link_names: false,
  unfurl_links: false,
  unfurl_media: false,
} as const;
/**
 * Fixed Koffierad channel messages. Only server-built links and times; no
 * names, mentions or client-supplied text. Never unfurled or broadcast.
 * (Round cards below may carry a Koekrad word, which `roundTitle` limits to
 * letters and hyphens and which only ever appears in literal text elements.)
 */
function body(channelId: string, elements: Element[]) {
  return {
    channel: channelId,
    text: fallback(elements),
    blocks: [
      {
        type: "rich_text",
        elements: [{ type: "rich_text_section", elements }],
      },
    ],
    ...options,
  };
}
/**
 * One card per round in the channel: a bold title, one line of status and an
 * optional quiet line under it. Text elements are literal, never parsed.
 */
function card(
  variant: ChannelVariant,
  startAt: number,
  status: Element[],
  context?: string,
  title?: string,
) {
  const theme = themeFor(variant, title),
    round = roundCopy(variant, title).round;
  const elements: Element[] = [
    {
      type: "text",
      text: `${theme.icon} ${round[0].toUpperCase()}${round.slice(1)} om ${clock.format(startAt)}`,
      style: { bold: true },
    },
    { type: "text", text: "\n" },
    ...status,
  ];
  return {
    elements,
    blocks: [
      {
        type: "rich_text",
        elements: [{ type: "rich_text_section", elements }],
      },
      ...(context
        ? [
            {
              type: "context",
              elements: [{ type: "plain_text", text: context, emoji: true }],
            },
          ]
        : []),
    ],
  };
}
/** The call for a round; its own reaction (☕ or 💧) is added right after. */
export function callBody(
  channelId: string,
  spectatorLink: string,
  startAt: number,
  variant: ChannelVariant = "coffee",
  /** With reviews the link opens the channel page, where people can log in. */
  linkText = "Kijk live mee",
  /** Koekrad only: the round's validated word. */
  title?: string,
) {
  const theme = themeFor(variant, title);
  const { elements, blocks } = card(
    variant,
    startAt,
    [
      {
        type: "text",
        text: `Klik op ${theme.icon} hieronder om mee te doen.\n`,
      },
      { type: "link", url: spectatorLink, text: linkText },
    ],
    `Het ${theme.name} kiest één ${theme.drink}haler.`,
    title,
  );
  return { channel: channelId, text: fallback(elements), blocks, ...options };
}
/** What a settled round shows in place of its call. */
export type CallOutcome =
  | {
      kind: "winner";
      names: string[];
      /** Server-frozen Slack identities in winner order; never from a client. */
      mentionIds: (string | null)[];
      participants: number;
      /** While the winner can be reviewed. */
      reviewUntil?: number;
      /** After the review closed: per winner, null when nobody reviewed them. */
      ratings?: ({ average: number; count: number } | null)[];
    }
  | { kind: "empty" | "unreadable" };
/** Server-frozen identities only; anything else stays literal text. */
function mention(name: string, id: string | null | undefined): Element {
  return id && /^[UW][A-Z0-9]{8,20}$/.test(id) && id !== "USLACKBOT"
    ? { type: "user", user_id: id }
    : { type: "text", text: name };
}
/**
 * The call message rewritten once the round is over, so the channel keeps one
 * message per round. Details stay in the thread; the call has no link left.
 */
export function settledCallBody(
  channelId: string,
  ts: string,
  startAt: number,
  variant: ChannelVariant,
  outcome: CallOutcome,
  /** The channel link, only while the round can still be reviewed. */
  reviewLink?: string,
  /** Koekrad only: the round's validated word. */
  title?: string,
) {
  const theme = themeFor(variant, title),
    copy = roundCopy(variant, title);
  let status: Element[];
  let context: string | undefined;
  let names: string[] = [];
  if (outcome.kind === "winner") {
    names = outcome.names;
    const ratings = outcome.ratings;
    status = [{ type: "text", text: "🏆 " }];
    outcome.names.forEach((name, index) => {
      if (index) status.push({ type: "text", text: " · " });
      status.push(mention(name, outcome.mentionIds[index]));
      const rating = ratings?.[index];
      if (rating && outcome.names.length > 1) {
        const display = slackRating(rating.average);
        status.push(
          { type: "text", text: " " },
          ...display.elements,
          { type: "text", text: ` ${display.value}` },
        );
      }
    });
    const many = outcome.names.length > 1;
    status.push({
      type: "text",
      text: ratings
        ? ` ${many ? "haalden" : "haalde"} ${theme.drink}`
        : ` ${many ? "halen" : "haalt"} ${theme.drink}`,
    });
    const single = ratings?.length === 1 ? ratings[0] : undefined;
    if (single) {
      const display = slackRating(single.average);
      status.push(
        { type: "text", text: " · " },
        ...display.elements,
        { type: "text", text: ` ${display.value}` },
      );
    }
    if (!ratings && outcome.reviewUntil && reviewLink)
      status.push(
        {
          type: "text",
          text: `\n⭐ Beoordeel de ${many ? "halers" : "haler"} tot ${clock.format(outcome.reviewUntil)}: `,
        },
        { type: "link", url: reviewLink, text: "Open de ronde" },
      );
    context = `${outcome.participants} ${outcome.participants === 1 ? "deed" : "deden"} mee`;
    if (ratings) {
      const count = Math.max(0, ...ratings.map((r) => r?.count ?? 0));
      context += count
        ? ` · ${count} ${count === 1 ? "beoordeling" : "beoordelingen"} in de thread`
        : " · geen beoordelingen";
    }
  } else
    status = [
      {
        type: "text",
        text:
          outcome.kind === "empty"
            ? `Niemand deed mee, dus het rad bleef stil. Dan maar zelf ${copy.tap}!`
            : `Het ${theme.name} kon de reacties niet lezen, dus er is niet gedraaid. Vraag gerust een nieuwe ronde aan.`,
      },
    ];
  const { elements, blocks } = card(variant, startAt, status, context, title);
  return {
    channel: channelId,
    ts,
    text: fallback(elements, names),
    blocks,
    ...options,
  };
}
/**
 * Slack-style emoji shortcodes, e.g. `:tim-koek:` or `:+1:`, never only digits
 * so times like `12:30:00` stay text. Unknown names simply show as text in
 * Slack. Our own `bierrad_` emoji stay text, so a review cannot fake stars.
 */
const shortcode =
  /:(?!bierrad_)(?=[a-z0-9_.+-]*[a-z_.+-])([a-z0-9_.+-]{1,100}):/g;
/**
 * A review text as literal text elements, with only shortcodes turned into
 * emoji elements. Nothing else is parsed: no mentions, links or formatting.
 */
function reviewText(text: string) {
  const elements: (
    | { type: "text"; text: string }
    | { type: "emoji"; name: string }
  )[] = [];
  let last = 0;
  for (const match of text.matchAll(shortcode)) {
    if (match.index > last)
      elements.push({ type: "text", text: text.slice(last, match.index) });
    elements.push({ type: "emoji", name: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length || !elements.length)
    elements.push({ type: "text", text: text.slice(last) });
  return elements;
}
/** The anonymous reviews of a round, as one reply in its thread. */
export function reviewBody(
  channelId: string,
  threadTs: string,
  results: {
    name: string;
    mentionId: string | null;
    average: number;
    count: number;
    texts: string[];
  }[],
) {
  const sections: Record<string, unknown>[] = [];
  const plain: string[] = [];
  results.forEach((result, index) => {
    const display = slackRating(result.average);
    const line: Element[] = [
      { type: "text", text: `${index ? "\n" : ""}⭐ Reviews voor ` },
      mention(result.name, result.mentionId),
      { type: "text", text: "\n" },
      ...display.elements,
      { type: "text", text: "  " },
      {
        type: "text",
        text: display.value,
        style: { bold: true },
      },
      {
        type: "text",
        text: ` gemiddeld · ${result.count} ${result.count === 1 ? "beoordeling" : "beoordelingen"}`,
      },
    ];
    sections.push({ type: "rich_text_section", elements: line });
    // Slack notifies from the fallback text, so the frozen identity is a real
    // mention there too; everything else is escaped.
    const who = line[1];
    plain.push(
      `${escape(`${index ? "\n" : ""}⭐ Reviews voor `)}${who.type === "user" ? `<@${who.user_id}>` : escape(result.name)}${escape(`\n${display.text}  ${display.value} gemiddeld · ${result.count} ${result.count === 1 ? "beoordeling" : "beoordelingen"}`)}`,
    );
    // Anonymous texts as literal text, one bullet each: Slack would merge
    // consecutive quotes into one.
    if (result.texts.length)
      sections.push({
        type: "rich_text_list",
        style: "bullet",
        elements: result.texts.map((text) => ({
          type: "rich_text_section",
          elements: reviewText(text),
        })),
      });
    for (const text of result.texts) plain.push(escape(`• ${text}`));
  });
  return {
    channel: channelId,
    thread_ts: threadTs,
    text: plain.join("\n"),
    blocks: [
      { type: "rich_text", elements: sections },
      {
        type: "context",
        elements: [
          {
            type: "plain_text",
            text: "Anoniem · de stemmen zijn gewist",
            emoji: true,
          },
        ],
      },
    ],
    ...options,
    reply_broadcast: false,
  };
}
/** Posting this also proves the bot is a member of the channel. */
export function boundBody(channelId: string, requestLink: string) {
  return body(channelId, [
    {
      type: "text",
      text: "☕ Het Koffierad is aan dit kanaal gekoppeld! Dit is ",
    },
    {
      type: "link",
      text: "het vaste Koffierad van dit kanaal",
      url: requestLink,
    },
    {
      type: "text",
      text: ": daar zie je steeds de huidige ronde. Een nieuwe ronde start je door hier /koffierad, /waterrad of /koekrad te typen (met bijvoorbeeld 10 erachter voor tien minuten, of /koekrad taart 10 voor een taartronde). Meedoen doe je door op ☕, 💧 of 🍪 te klikken onder de oproep. Eerdere links van dit kanaal werken niet meer.",
    },
  ]);
}
