import { DEFAULT_BEER_TIME, validWinnerCount } from "../../shared/channel";
import { MAX_SCHEDULE_AHEAD_MS } from "../../shared/retention";
import { cleanReviewText } from "../../shared/reviews";
import { amsterdamInput, parseAmsterdamInput } from "../../src/utils/schedule";

/** A Bierrad round starts at least this long after the command. */
export const MIN_BEER_LEAD_MS = 60000;
/** Own text above the Bierrad call, after cleanup. */
export const MAX_INTRO_LENGTH = 500;
const MAX_INTRO_LINES = 8;

/** Slack sends `&`, `<` and `>` in slash command text as entities. */
const unescape = (text: string) =>
  text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/**
 * The own text of a `/bierrad`: cleaned like a review text (NFC, no control or
 * invisible formatting), bounded, or undefined when empty or too long. Display
 * only; the call shows it as literal Slack text.
 */
export function cleanIntro(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length > MAX_INTRO_LENGTH * 4) return;
  const text = cleanReviewText(raw);
  return text &&
    text.length <= MAX_INTRO_LENGTH &&
    text.split("\n").length <= MAX_INTRO_LINES
    ? text
    : undefined;
}

const days = [
  "zondag",
  "maandag",
  "dinsdag",
  "woensdag",
  "donderdag",
  "vrijdag",
  "zaterdag",
];
const shortDays = ["zo", "ma", "di", "wo", "do", "vr", "za"];
type BeerDay =
  | { kind: "offset"; days: number }
  | { kind: "weekday"; day: number }
  | { kind: "date"; day: number; month: number; year?: number };
function beerDay(token: string): BeerDay | undefined {
  const word = token.toLocaleLowerCase("nl");
  const offset = ["vandaag", "morgen", "overmorgen"].indexOf(word);
  if (offset >= 0) return { kind: "offset", days: offset };
  const weekday = days.includes(word)
    ? days.indexOf(word)
    : shortDays.indexOf(word);
  if (weekday >= 0) return { kind: "weekday", day: weekday };
  const date = /^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?$/.exec(token);
  if (date)
    return {
      kind: "date",
      day: Number(date[1]),
      month: Number(date[2]),
      ...(date[3] ? { year: Number(date[3]) } : {}),
    };
}
const pad = (n: number) => String(n).padStart(2, "0");
/** The calendar day `count` days after `ymd`. */
function addDays(ymd: string, count: number): string {
  const day = new Date(`${ymd}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + count);
  return day.toISOString().slice(0, 10);
}

export type BeerRequest =
  | { ok: true; startAt: number; winners?: number; intro?: string }
  | { ok: false; reason: "help" | "past" | "far" | "intro" };
/**
 * `/bierrad [dag] [tijd] [aantal] [eigen tekst]`. Day, time and number come
 * first, in any order and each at most once; whatever follows is the own text.
 * Without a day: today; without a time: 15:45, both Dutch time. A weekday is
 * the next one whose time is still ahead; today or a date that has passed is
 * refused, never moved to another day.
 */
export function parseBeerText(raw: string, now: number): BeerRequest {
  let rest = raw.trim();
  let day: BeerDay | undefined,
    time: string | undefined,
    winners: number | undefined;
  for (let i = 0; i < 3 && rest; i++) {
    const token = /^\S+/.exec(rest)![0];
    const asDay = day ? undefined : beerDay(token);
    const asTime = time
      ? undefined
      : /^([01]?\d|2[0-3])[.:]([0-5]\d)$/.exec(token);
    const asCount =
      winners === undefined &&
      /^\d{1,2}$/.test(token) &&
      validWinnerCount(Number(token))
        ? Number(token)
        : undefined;
    if (asDay) day = asDay;
    else if (asTime) time = `${pad(Number(asTime[1]))}:${asTime[2]}`;
    else if (asCount !== undefined) winners = asCount;
    else break;
    rest = rest.slice(token.length).replace(/^[^\S\n]*\n?/, "");
  }
  const text = unescape(rest);
  const intro = cleanIntro(text);
  if (text.trim() && !intro) return { ok: false, reason: "intro" };
  const today = amsterdamInput(now).slice(0, 10);
  const at = (ymd: string) =>
    parseAmsterdamInput(`${ymd}T${time ?? DEFAULT_BEER_TIME}`);
  let startAt: number;
  if (!day || day.kind === "offset")
    startAt = at(addDays(today, day?.days ?? 0));
  else if (day.kind === "weekday") {
    const ahead = (day.day - new Date(`${today}T00:00:00Z`).getUTCDay() + 7) % 7;
    startAt = at(addDays(today, ahead));
    if (!(startAt >= now + MIN_BEER_LEAD_MS))
      startAt = at(addDays(today, ahead + 7));
  } else {
    const ymd = `${day.year ?? today.slice(0, 4)}-${pad(day.month)}-${pad(day.day)}`;
    // 31-2 and other days that do not exist.
    const check = new Date(`${ymd}T00:00:00Z`);
    if (
      !Number.isFinite(check.getTime()) ||
      check.toISOString().slice(0, 10) !== ymd
    )
      return { ok: false, reason: "help" };
    startAt = at(ymd);
  }
  // Also the hour that does not exist when the clocks go forward.
  if (!Number.isFinite(startAt)) return { ok: false, reason: "help" };
  if (startAt < now + MIN_BEER_LEAD_MS) return { ok: false, reason: "past" };
  if (startAt > now + MAX_SCHEDULE_AHEAD_MS) return { ok: false, reason: "far" };
  return {
    ok: true,
    startAt,
    ...(winners !== undefined ? { winners } : {}),
    ...(intro ? { intro } : {}),
  };
}
