import {
  cleanReviewText,
  validSubmission,
  type ReviewBallot,
  type ReviewProgress,
} from "../shared/reviews";
import { RequestError, type StoredSession } from "./session";
import { participantSlackIds } from "./slack/state";

/** Voting opens this long after the last reveal. */
export const REVIEW_DELAY_MS = 60000;

/**
 * Reviews of one channel round. Only temporary: pseudonyms, the key and the
 * link are erased when the review closes, the votes once it has been posted,
 * and everything with the session.
 */
export interface RoundReview {
  minutes: number;
  /** Per-binding HMAC key for pseudonyms; erased at close. */
  key?: string;
  /** The channel link already posted in the channel ("Open de ronde"); erased at close. */
  link?: string;
  status: "waiting" | "open" | "closed";
  drawId?: string;
  /** A minute after the last reveal: no ballot names a winner before the wheels stop, and the finale gets its moment. */
  opensAt?: number;
  closesAt?: number;
  winners?: {
    name: string;
    /** Server-frozen Slack identity; only these winners can be reviewed. */
    mentionId: string | null;
    pseudonym: string | null;
  }[];
  /** Pseudonyms of everyone who may still or already did vote. */
  eligible?: string[];
  voted?: string[];
  /** Per winner, never per voter. */
  totals?: { sum: number; count: number; texts: string[] }[];
  job?: ReviewJob;
}
export interface ReviewResult {
  name: string;
  mentionId: string | null;
  average: number;
  count: number;
  /** Shuffled, so their order says nothing about who wrote them. */
  texts: string[];
}
export interface ReviewJob {
  /** Still to post, one reply per winner; the first is the current one. */
  results: ReviewResult[];
  status: "pending" | "posting" | "posted" | "failed" | "uncertain";
  readyAt: number;
  attempts: number;
  attemptedAt?: number;
}

function lastSpinEnd(record: StoredSession): number | undefined {
  const draw = record.session.activeDraw;
  return draw
    ? Math.max(...draw.spins.map((s) => Date.parse(s.startAt) + s.durationMs))
    : undefined;
}
/** When voting opens and closes for the current draw; always before the session ends. */
export function reviewTimes(
  record: StoredSession,
  minutes: number,
): { opensAt: number; closesAt: number } | undefined {
  const end = lastSpinEnd(record);
  if (end === undefined) return;
  const opensAt = end + REVIEW_DELAY_MS;
  return {
    opensAt,
    closesAt: Math.min(opensAt + minutes * 60000, record.expiresAt - 60000),
  };
}
/**
 * Freezes who may vote on which winner when the draw starts. `pseudonyms`
 * maps every Slack participant of the draw to its pseudonym.
 */
export function openReview(
  record: StoredSession,
  pseudonyms: Map<string, string>,
): void {
  const review = record.review,
    draw = record.session.activeDraw,
    slack = record.slack;
  const end = lastSpinEnd(record);
  const times = review && reviewTimes(record, review.minutes);
  if (review?.status !== "waiting" || !draw || !slack || end === undefined || !times)
    return;
  const slackIds = participantSlackIds(slack);
  const pseudonymOf = (participantId: string) => {
    const slackId = slackIds.get(participantId);
    return slackId ? (pseudonyms.get(slackId) ?? null) : null;
  };
  review.drawId = draw.id;
  review.opensAt = times.opensAt;
  review.winners = draw.spins.map((spin) => {
    const slackId = slackIds.get(spin.winnerId) ?? null;
    return {
      name: record.session.participants.find((p) => p.id === spin.winnerId)!
        .name,
      mentionId: slackId,
      pseudonym: pseudonymOf(spin.winnerId),
    };
  });
  const ratable = review.winners.filter((w) => w.mentionId && w.pseudonym);
  review.eligible = [
    ...new Set(
      draw.participantIds
        .map(pseudonymOf)
        .filter(
          (p): p is string =>
            !!p && ratable.some((winner) => winner.pseudonym !== p),
        ),
    ),
  ];
  review.voted = [];
  review.totals = review.winners.map(() => ({ sum: 0, count: 0, texts: [] }));
  review.closesAt = times.closesAt;
  review.status = "open";
  if (!review.eligible.length) closeReview(record, end);
  else if (record.slack?.card?.kind === "winner") {
    record.slack.card.reviewUntil = review.closesAt;
    record.slack.card.status = "pending";
    record.slack.card.attempts = 0;
  }
}
function ballotWinners(review: RoundReview, pseudonym: string) {
  return (review.winners ?? [])
    .map((w, index) => ({ ...w, index }))
    .filter((w) => w.mentionId && w.pseudonym && w.pseudonym !== pseudonym);
}
export function reviewBallot(
  record: StoredSession,
  pseudonym: string,
  now: number,
): ReviewBallot | undefined {
  const review = record.review;
  if (
    review?.status !== "open" ||
    now < review.opensAt! ||
    now >= review.closesAt! ||
    !review.eligible!.includes(pseudonym)
  )
    return;
  return {
    drawId: review.drawId!,
    closesAt: new Date(review.closesAt!).toISOString(),
    winners: ballotWinners(review, pseudonym).map((w) => ({
      index: w.index,
      name: w.name,
    })),
    submitted: review.voted!.includes(pseudonym),
  };
}
/** One ballot per pseudonym; resolves whether everyone has now voted. */
export function submitReview(
  record: StoredSession,
  pseudonym: string,
  drawId: unknown,
  submission: unknown,
  now: number,
): boolean {
  const review = record.review;
  if (review?.status !== "open" || review.drawId !== drawId)
    throw new RequestError(409, "review_closed");
  if (now < review.opensAt! || now >= review.closesAt!)
    throw new RequestError(409, "review_closed");
  if (!review.eligible!.includes(pseudonym))
    throw new RequestError(403, "review_forbidden");
  if (review.voted!.includes(pseudonym))
    throw new RequestError(409, "review_done");
  const winners = ballotWinners(review, pseudonym);
  if (!validSubmission(submission, winners.length))
    throw new RequestError(400, "invalid");
  winners.forEach((winner, i) => {
    const total = review.totals![winner.index];
    total.sum += submission.scores[i];
    total.count++;
    const text = cleanReviewText(submission.texts[i]);
    if (text) total.texts.push(text);
  });
  review.voted!.push(pseudonym);
  return review.voted!.length >= review.eligible!.length;
}
function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
/**
 * Ends voting: keeps only per-winner results for the thread post and the
 * call, and erases every pseudonym, the key and the link.
 */
export function closeReview(record: StoredSession, now: number): void {
  const review = record.review;
  if (review?.status !== "open") return;
  const results = (review.winners ?? [])
    .map((w, i) => ({ winner: w, total: review.totals![i] }))
    .filter(({ winner, total }) => winner.mentionId && total.count)
    .map(({ winner, total }) => ({
      name: winner.name,
      mentionId: winner.mentionId,
      average: total.sum / total.count,
      count: total.count,
      texts: shuffled(total.texts),
    }));
  // Nobody could vote (for example one participant): the call never asked.
  const asked = !!review.eligible?.length;
  review.status = "closed";
  delete review.key;
  delete review.link;
  delete review.eligible;
  delete review.voted;
  delete review.totals;
  delete review.winners;
  if (results.length)
    review.job = { results, status: "pending", readyAt: now, attempts: 0 };
  const card = record.slack?.card;
  if (asked && card?.kind === "winner") {
    delete card.reviewUntil;
    card.ratings = card.names.map((name, i) => {
      const result = results.find(
        (r) => r.mentionId === card.mentionIds[i] && r.name === name,
      );
      return result ? { average: result.average, count: result.count } : null;
    });
    card.status = "pending";
    card.readyAt = now;
    card.attempts = 0;
  }
}
/** The votes are erased once the post has settled, whatever its outcome. */
export function settleReviewJob(job: ReviewJob, status: ReviewJob["status"]) {
  job.status = status;
  if (status !== "pending" && status !== "posting") job.results = [];
}
/**
 * Each winner gets their own reply, posted in turn: once the first settles,
 * whatever its outcome, its texts are erased and the next is due at once.
 */
export function settleReviewPost(
  job: ReviewJob,
  status: "posted" | "failed" | "uncertain",
  now: number,
) {
  job.results.shift();
  if (!job.results.length) return settleReviewJob(job, status);
  job.status = "pending";
  job.readyAt = now;
  job.attempts = 0;
  delete job.attemptedAt;
}
export function reviewProgress(
  record: StoredSession,
): ReviewProgress | undefined {
  const review = record.review;
  if (review?.status !== "open") return;
  return {
    closesAt: new Date(review.closesAt!).toISOString(),
    voted: review.voted!.length,
    eligible: review.eligible!.length,
  };
}
export function reviewDeadline(record: StoredSession): number | undefined {
  const review = record.review;
  if (review?.status === "open") return review.closesAt;
  const job = review?.job;
  if (job?.status === "pending") return job.readyAt;
  if (job?.status === "posting") return job.attemptedAt! + 120000;
}
