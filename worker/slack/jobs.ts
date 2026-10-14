import {
  beerReminderBody,
  reviewBody,
  settledCallBody,
} from "../channel/messages";
import { isChannelVariant } from "../../shared/channel";
import { SlackApiClient } from "./api";
import {
  postMessage,
  postResult,
  updateMessage,
  MAX_CARD_ATTEMPTS,
} from "./state";
import { slackAllowed, slackEnvironment, type SlackSecrets } from "./access";
import { closeReview, settleReviewJob, settleReviewPost } from "../reviews";
import { nextDeadline, type StoredSession } from "../session";

/** Durable claims and bounded delivery retries, separate from draw authority. */
export class SessionSlackJobs {
  constructor(
    private env: Env & SlackSecrets,
    private ctx: DurableObjectState,
    private read: () => StoredSession | undefined,
    private save: (record: StoredSession) => void,
    private broadcast: (record: StoredSession) => void,
  ) {}
  async processChannelReminder() {
    const record = this.read();
    const reminder = record?.slack?.reminder,
      source = record?.slack?.source;
    if (!record || Date.now() >= record.expiresAt || !reminder || !source)
      return;
    const settle = (
      target: StoredSession,
      status: "posted" | "failed" | "uncertain" | "skipped",
    ) => {
      const r = target.slack!.reminder!;
      r.status = status;
      delete r.login;
      delete r.view;
      this.save(target);
    };
    if (reminder.status === "posting") {
      if (Date.now() >= reminder.attemptedAt! + 120000)
        settle(record, "uncertain");
      return;
    }
    if (reminder.status !== "pending" || reminder.readyAt > Date.now()) return;
    const plan = record.scheduledDraw;
    if (
      !reminder.view ||
      plan?.status !== "pending" ||
      Date.now() >= Date.parse(plan.startAt) - 30000 ||
      !slackAllowed(
        record.slack!.grantHash,
        slackEnvironment(this.env, record.variant),
      )
    ) {
      settle(record, "skipped");
      return;
    }
    const body = beerReminderBody(source.channelId, source.parentMessageTs, {
      view: reminder.view,
      ...(reminder.login ? { login: reminder.login } : {}),
    });
    reminder.status = "posting";
    reminder.attempts++;
    const attemptedAt = (reminder.attemptedAt = Date.now());
    this.save(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    await this.ctx.storage.sync();
    const result = await postMessage(
      new SlackApiClient(
        slackEnvironment(this.env, record.variant).SLACK_BOT_TOKEN!,
      ),
      source.channelId,
      body,
    );
    const latest = this.read();
    const current = latest?.slack?.reminder;
    if (
      !latest ||
      Date.now() >= latest.expiresAt ||
      current?.status !== "posting" ||
      current.attemptedAt !== attemptedAt
    )
      return;
    const start = Date.parse(latest.scheduledDraw?.startAt ?? "");
    if (
      result.status === "failed" &&
      current.attempts < 2 &&
      result.retryAt < start - 30000
    ) {
      current.status = "pending";
      current.readyAt = result.retryAt;
      this.save(latest);
    } else settle(latest, result.status);
    await this.ctx.storage.setAlarm(nextDeadline(latest));
  }
  async processSlackResult() {
    const record = this.read();
    const job = record?.slack?.job;
    if (!record || Date.now() >= record.expiresAt || !job) return;
    if (job.status === "posting") {
      if (Date.now() >= job.attemptedAt! + 120000) {
        job.status = "uncertain";
        record.revision++;
        this.save(record);
        this.broadcast(record);
      }
      return;
    }
    if (job.status !== "pending" || job.readyAt > Date.now()) return;
    if (
      !slackAllowed(
        record.slack!.grantHash,
        slackEnvironment(this.env, record.variant),
      )
    ) {
      job.status = "failed";
      job.retryAt = Date.now() + 60000;
      record.revision++;
      this.save(record);
      this.broadcast(record);
      return;
    }
    // Claim synchronously before any await. Persist + arm crash recovery before external I/O.
    job.status = "posting";
    job.attemptedAt = Date.now();
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    await this.ctx.storage.sync();
    const current = this.read();
    if (
      !current ||
      Date.now() >= current.expiresAt ||
      !slackAllowed(
        current.slack?.grantHash,
        slackEnvironment(this.env, current.variant),
      )
    )
      return;
    const result = await postResult(
      new SlackApiClient(
        slackEnvironment(this.env, record.variant).SLACK_BOT_TOKEN!,
      ),
      job,
    );
    const latest = this.read();
    if (
      !latest ||
      Date.now() >= latest.expiresAt ||
      latest.slack?.job?.drawId !== job.drawId ||
      latest.slack.job.status !== "posting"
    )
      return;
    Object.assign(latest.slack.job, result);
    latest.revision++;
    this.save(latest);
    this.broadcast(latest);
  }
  /**
   * Rewrites a settled channel round's call. Same claim-before-I/O discipline
   * as posts, but an update is idempotent, so an uncertain one may be repeated
   * (at most MAX_CARD_ATTEMPTS times in total).
   */
  async processCallCard() {
    const record = this.read();
    const card = record?.slack?.card,
      source = record?.slack?.source;
    if (!record || Date.now() >= record.expiresAt || !card || !source) return;
    if (card.status === "updating") {
      if (Date.now() < card.attemptedAt! + 120000) return;
      card.status = "pending";
    }
    if (card.status !== "pending" || card.readyAt > Date.now()) return;
    const variant = record.variant;
    if (
      card.attempts >= MAX_CARD_ATTEMPTS ||
      !isChannelVariant(variant) ||
      !slackAllowed(
        record.slack!.grantHash,
        slackEnvironment(this.env, variant),
      )
    ) {
      card.status = "failed";
      this.save(record);
      return;
    }
    card.status = "updating";
    card.attempts++;
    const attemptedAt = (card.attemptedAt = Date.now());
    this.save(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    await this.ctx.storage.sync();
    const result = await updateMessage(
      new SlackApiClient(slackEnvironment(this.env, variant).SLACK_BOT_TOKEN!),
      settledCallBody(
        source.channelId,
        source.parentMessageTs,
        card.startAt,
        variant,
        card,
        record.review?.status === "open" ? record.review.link : undefined,
        record.title,
        record.intro,
      ),
    );
    const latest = this.read();
    const current = latest?.slack?.card;
    if (
      !latest ||
      Date.now() >= latest.expiresAt ||
      current?.status !== "updating" ||
      current.attemptedAt !== attemptedAt
    )
      return;
    if (result.status === "updated") current.status = "updated";
    else if (current.attempts >= MAX_CARD_ATTEMPTS) current.status = "failed";
    else {
      current.status = "pending";
      current.readyAt = result.retryAt;
    }
    this.save(latest);
    await this.ctx.storage.setAlarm(nextDeadline(latest));
  }
  /**
   * Closes voting at its deadline, then posts the anonymous results in the
   * thread, one reply per winner. Each reply is claimed before I/O, never
   * repeated when delivery is uncertain, retried at most once after a definite
   * rejection.
   */
  async processReview() {
    const record = this.read();
    const review = record?.review,
      source = record?.slack?.source;
    if (!record || Date.now() >= record.expiresAt || !review || !source) return;
    if (review.status === "open" && Date.now() >= review.closesAt!) {
      closeReview(record, Date.now());
      record.revision++;
      this.save(record);
      this.broadcast(record);
    }
    const job = review.job;
    if (!job) return;
    if (job.status === "posting") {
      if (Date.now() >= job.attemptedAt! + 120000) {
        settleReviewPost(job, "uncertain", Date.now());
        this.save(record);
        await this.ctx.storage.setAlarm(nextDeadline(record));
      }
      return;
    }
    if (job.status !== "pending" || job.readyAt > Date.now()) return;
    const variant = record.variant ?? "coffee";
    if (
      !slackAllowed(
        record.slack!.grantHash,
        slackEnvironment(this.env, variant),
      )
    ) {
      settleReviewJob(job, "failed");
      this.save(record);
      return;
    }
    job.status = "posting";
    job.attempts++;
    const attemptedAt = (job.attemptedAt = Date.now());
    this.save(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    await this.ctx.storage.sync();
    const result = await postMessage(
      new SlackApiClient(slackEnvironment(this.env, variant).SLACK_BOT_TOKEN!),
      source.channelId,
      reviewBody(source.channelId, source.parentMessageTs, job.results[0]),
    );
    const latest = this.read();
    const current = latest?.review?.job;
    if (
      !latest ||
      Date.now() >= latest.expiresAt ||
      current?.status !== "posting" ||
      current.attemptedAt !== attemptedAt
    )
      return;
    if (result.status === "failed" && current.attempts < 2) {
      current.status = "pending";
      current.readyAt = result.retryAt;
    } else settleReviewPost(current, result.status, Date.now());
    this.save(latest);
    await this.ctx.storage.setAlarm(nextDeadline(latest));
  }
}
