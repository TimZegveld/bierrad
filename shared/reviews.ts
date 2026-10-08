/** Public contract for round reviews. No Slack IDs, pseudonyms or capabilities. */
import type { WheelVariant } from "./variant";

/** Optional text per reviewed winner. */
export const REVIEW_TEXT_MAX = 280;
export const REVIEW_MINUTE_CHOICES = [5, 10, 15, 30] as const;
export const DEFAULT_REVIEW_MINUTES = 15;
/** Personal links per channel; the oldest login makes way for a new one. */
export const MAX_MEMBERS = 500;
export const MEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Playful labels for 1–5 stars; shown in the app only, never in Slack. */
export const reviewLabels: Record<
  WheelVariant,
  readonly [string, string, string, string, string]
> = {
  beer: ["Lauw en verschaald", "Huismerk", "Prima pils", "Goed getapt", "Vrijdagmiddagheld"],
  coffee: ["Slootwater", "Lauw bakkie", "Prima bakkie", "Lekker bakkie", "Barista-niveau"],
  water: [
    "Lauw en troebel",
    "Gewoon kraanwater",
    "Lekker fris",
    "Bergbronkwaliteit",
    "Gemeentepils van topkwaliteit",
  ],
  cookie: ["Oud en zacht", "Droog kruimeltje", "Prima traktatie", "Smullen geblazen", "Banketbakkersniveau"],
};

export interface ReviewSettings {
  /** The default for new rounds (on unless the admin turned it off); a request may choose otherwise. */
  enabled: boolean;
  minutes: number;
}
export const DEFAULT_REVIEW_SETTINGS: ReviewSettings = {
  enabled: true,
  minutes: DEFAULT_REVIEW_MINUTES,
};
export function validReviewMinutes(value: unknown): value is number {
  return (REVIEW_MINUTE_CHOICES as readonly unknown[]).includes(value);
}
/** What shared screens may show while a round can be reviewed: counts only. */
export interface ReviewProgress {
  closesAt: string;
  voted: number;
  eligible: number;
}
/**
 * A closed round's reviews of one winner, as its result page shows them: the
 * same anonymous average, count and shuffled texts the thread reply posts.
 */
export interface ReviewOutcome {
  name: string;
  average: number;
  count: number;
  texts: string[];
}
/** One person's ballot: only the winners they may review, never themselves. */
export interface ReviewBallot {
  drawId: string;
  closesAt: string;
  winners: { index: number; name: string }[];
  submitted: boolean;
}
/** Aligned with the ballot's winners, in the same order. */
export interface ReviewSubmission {
  scores: number[];
  texts: string[];
}

/** NFC, no control or invisible formatting characters, single spaces per line. */
export function cleanReviewText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, (c) => (c === "\n" ? "\n" : " "))
    // Drops bidi overrides and other invisible formatting; keeps emoji joiners.
    .replace(/(?!‍)\p{Cf}/gu, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, i, all) => line || (i > 0 && all[i - 1]))
    .join("\n")
    .trim();
}
export function validSubmission(
  value: unknown,
  count: number,
): value is ReviewSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 2 &&
    Array.isArray(v.scores) &&
    Array.isArray(v.texts) &&
    v.scores.length === count &&
    v.texts.length === count &&
    v.scores.every(
      (s) => typeof s === "number" && Number.isInteger(s) && s >= 1 && s <= 5,
    ) &&
    v.texts.every(
      (t) =>
        typeof t === "string" &&
        t.length <= REVIEW_TEXT_MAX * 2 &&
        cleanReviewText(t).length <= REVIEW_TEXT_MAX,
    )
  );
}
