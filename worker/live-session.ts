import { SessionSlackJobs } from "./slack/jobs";
import {
  isGoalVariant,
  JOIN_CUTOFF_MS,
  MAX_ROUND_GOALS,
  validGoals,
  type ChannelVariant,
  type RoundGoal,
} from "../shared/channel";
import { cleanIntro } from "./channel/beer";
import { validWinnerCount } from "../shared/channel";
import { roundTitle, type WheelVariant } from "../shared/variant";
import { SlackApiClient, SlackError } from "./slack/api";
import {
  SlackReactionParticipantSource,
  type SlackSource,
} from "./slack/source";
import {
  addGoal,
  queueBierfeestNotice,
  reconcile,
  roundReactions,
} from "./slack/state";
import {
  CHANNEL_GRANT,
  slackAllowed,
  slackEnvironment,
  type SlackSecrets,
} from "./slack/access";
import { getCapabilities } from "../src/domain/capabilities";
import { DurableObject } from "cloudflare:workers";
import {
  equalHash,
  hashSecret,
  parseCapability,
  pseudonym,
  randomHex,
} from "./auth";
import {
  closeReview,
  openReview,
  reviewBallot,
  submitReview,
} from "./reviews";
import type { ReviewBallot } from "../shared/reviews";
import { createSession, withGoals } from "../src/domain/drawEngine";
import { SCHEDULE_RETENTION_MS } from "../shared/retention";
import {
  advance,
  channelRefreshAt,
  refreshInterval,
  executeScheduledDraw,
  START_DELAY_MS,
  mutate,
  newSession,
  nextDeadline,
  publicSession,
  RequestError,
  type StoredSession,
} from "./session";
import { json } from "./http";
import type { ClientRole } from "../src/domain/models";
import type { ServerToClientMessage } from "../shared/protocol";

interface Attachment {
  role: ClientRole;
  window: number;
  messages: number;
}
export class LiveSession extends DurableObject<Env & SlackSecrets> {
  private read(): StoredSession | undefined {
    if (
      !this.ctx.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE name = 'session'")
        .toArray().length
    )
      return undefined;
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM session WHERE singleton = 1")
      .toArray()[0];
    return row ? (JSON.parse(row.value) as StoredSession) : undefined;
  }
  private save(record: StoredSession) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO session VALUES (1, ?)",
      JSON.stringify(record),
    );
  }
  async initialize(
    hostHash: string,
    spectatorHash: string,
    variant: WheelVariant = "beer",
  ): Promise<string> {
    if (this.read()) throw new Error("unavailable");
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS session (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), value TEXT NOT NULL)",
    );
    const record = newSession(hostHash, spectatorHash, Date.now(), variant);
    this.save(record);
    await this.ctx.storage.setAlarm(record.expiresAt);
    return new Date(record.expiresAt).toISOString();
  }
  /**
   * A round of a channel-bound wheel: spectators only, the Slack call message
   * as source and a fixed start. Nobody receives host rights. Coffee, water
   * and Koekrad rounds have one winner; a Bierrad round its own number, own
   * text and a reminder in the thread.
   */
  async initializeChannelRound(
    spectatorHash: string,
    source: SlackSource,
    startAt: number,
    excludeUserIds: string[],
    variant: ChannelVariant = "coffee",
    review?: { minutes: number; key: string; link: string },
    title?: string,
    beer?: {
      winners: number;
      intro?: string;
      reminder?: { readyAt: number; login?: string; view: string };
    },
  ): Promise<void> {
    const hostHash = await hashSecret(randomHex());
    if (this.read()) throw new Error("unavailable");
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS session (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), value TEXT NOT NULL)",
    );
    const now = Date.now();
    const record = newSession(hostHash, spectatorHash, now, variant);
    // Validated again: only a Koekrad round carries a word.
    const word = variant === "cookie" ? roundTitle(title) : undefined;
    if (word) record.title = word;
    // Validated again: only a Bierrad round has more winners and its own text.
    const winners =
      variant === "beer" && validWinnerCount(beer?.winners) ? beer.winners : 1;
    const intro = variant === "beer" ? cleanIntro(beer?.intro) : undefined;
    if (intro) record.intro = intro;
    record.preferredCount = winners;
    record.session = createSession(record.session.id, [], winners);
    record.expiresAt = startAt + SCHEDULE_RETENTION_MS;
    record.scheduledDraw = {
      startAt: new Date(startAt).toISOString(),
      status: "pending",
    };
    record.slack = {
      grantHash: CHANNEL_GRANT,
      grantExpiresAt: record.expiresAt,
      mapping: {},
      source: { ...source },
      channelRound: true,
      excludeUserIds: [...excludeUserIds],
      // The first read waits a minute: right after posting only the bot reacted.
      nextImportAt: now + 60000,
      ...(variant === "beer" &&
      beer?.reminder &&
      beer.reminder.readyAt > now &&
      beer.reminder.readyAt < startAt
        ? {
            reminder: {
              readyAt: beer.reminder.readyAt,
              view: beer.reminder.view,
              ...(beer.reminder.login ? { login: beer.reminder.login } : {}),
              status: "pending" as const,
              attempts: 0,
            },
          }
        : {}),
    };
    if (review) record.review = { ...review, status: "waiting" };
    this.save(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
  }
  /**
   * A waiting channel round gains a goal from another `/waterrad` or
   * `/koekrad` in its channel and becomes a Feestrad. Only before the cutoff,
   * never once the draw is being prepared. Resolves every goal, or why not.
   */
  async addChannelGoal(
    goal: RoundGoal,
  ): Promise<
    | { goals: RoundGoal[] }
    | { code: "too_late" | "present" | "full" | "unavailable" }
  > {
    const record = this.read();
    const now = Date.now();
    if (
      !record ||
      now >= record.expiresAt ||
      !record.slack?.channelRound ||
      !isGoalVariant(record.variant)
    )
      return { code: "unavailable" };
    const plan = record.scheduledDraw;
    if (
      plan?.status !== "pending" ||
      record.session.activeDraw ||
      now >= Date.parse(plan.startAt) - JOIN_CUTOFF_MS
    )
      return { code: "too_late" };
    const goals = record.goals ?? [
      { variant: record.variant, ...(record.title ? { title: record.title } : {}) },
    ];
    if (goals.some((g) => g.variant === goal.variant)) return { code: "present" };
    if (goals.length >= MAX_ROUND_GOALS) return { code: "full" };
    // Validated again: known kinds, each once, a word only for koek.
    const valid = validGoals([...goals, goal]);
    if (!valid) return { code: "unavailable" };
    addGoal(record, valid.at(-1)!);
    // Read the new emoji soon, so the new wheel fills while people react.
    record.slack.nextImportAt = Math.min(
      record.slack.nextImportAt ?? Infinity,
      now + 20000,
    );
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    return { goals: record.goals!.map((g) => ({ ...g })) };
  }
  /** Undoes the last goal when its announcement was refused; only before the draw. */
  async removeChannelGoal(variant: unknown): Promise<void> {
    const record = this.read();
    const goals = record?.goals;
    if (
      !record ||
      Date.now() >= record.expiresAt ||
      !goals ||
      goals.at(-1)!.variant !== variant ||
      record.scheduledDraw?.status !== "pending" ||
      record.session.activeDraw
    )
      return;
    const s = record.session;
    const pools = (s.goals ?? []).slice(0, goals.length - 1);
    const kept = new Set(pools.flatMap((g) => [...g.participantIds]));
    const people = s.participants.filter((p) => kept.has(p.id));
    if (pools.length > 1) {
      record.goals = goals.slice(0, -1);
      record.session = withGoals(createSession(s.id, people, 1), pools);
    } else {
      delete record.goals;
      const [own] = pools;
      record.session = createSession(
        s.id,
        (own?.participantIds ?? []).map((id, i) => {
          const person = people.find((p) => p.id === id)!;
          const weight = own.weights?.[i] ?? 1;
          return weight > 1 ? { ...person, weight } : person;
        }),
        record.preferredCount,
      );
    }
    record.revision++;
    this.save(record);
    this.broadcast(record);
  }
  /** True once a channel round no longer blocks the next: drawn and stopped, skipped or gone. */
  async channelRoundSettled(): Promise<boolean> {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt) return true;
    // Evaluate the current phase without waiting for the alarm; nothing is saved.
    advance(record, Date.now());
    return (
      record.session.state === "finished" ||
      (record.scheduledDraw?.status === "skipped" && !record.session.activeDraw)
    );
  }
  /** Keep the result visible for five minutes after voting closes, within the session TTL. */
  async channelRoundWatchUntil(): Promise<number | null> {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt || !record.review?.closesAt) return null;
    return Math.min(record.expiresAt, record.review.closesAt + 5 * 60000);
  }
  private async expire() {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ type: "unavailable" }));
        ws.close(4004, "unavailable");
      } catch {
        /* Already disconnected. */
      }
    }
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
  private message(
    record: StoredSession,
    role: ClientRole,
  ): ServerToClientMessage {
    return {
      type: "snapshot",
      session: publicSession(record),
      role,
      serverNow: Date.now(),
    };
  }
  private broadcast(record: StoredSession) {
    if (Date.now() >= record.expiresAt) return;
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (!attachment) {
        ws.close(4003, "unavailable");
        continue;
      }
      try {
        ws.send(JSON.stringify(this.message(record, attachment.role)));
      } catch {
        /* No names or access codes in diagnostics. */
      }
    }
  }
  private async authenticate(secret: string) {
    // Hash before reading state: no await between read, authorization and mutation.
    const hash = await hashSecret(secret);
    const record = this.read();
    if (!record) throw new RequestError(404, "unavailable");
    if (Date.now() >= record.expiresAt) {
      await this.expire();
      throw new RequestError(404, "unavailable");
    }
    const role: ClientRole | undefined = equalHash(hash, record.hostHash)
      ? "host"
      : equalHash(hash, record.spectatorHash)
        ? "spectator"
        : undefined;
    if (!role) throw new RequestError(404, "unavailable");
    return role;
  }
  async access(secret: string, command: unknown): Promise<Response> {
    try {
      const role = await this.authenticate(secret);
      // Re-read after the await, protecting concurrent requests/expiry.
      const record = this.read();
      if (!record || Date.now() >= record.expiresAt)
        throw new RequestError(404, "unavailable");
      const advanced = advance(record, Date.now());
      if (advanced) {
        this.save(record);
        this.broadcast(record);
      }
      if (command !== null) {
        mutate(record, role, command, Date.now());
        this.save(record);
        await this.openRoundReview();
      }
      if (Date.now() >= record.expiresAt) {
        await this.expire();
        return json({ type: "unavailable" });
      }
      this.broadcast(record);
      const result = this.message(record, role);
      await this.ctx.storage.setAlarm(nextDeadline(record));
      if (Date.now() >= record.expiresAt) {
        await this.expire();
        return json({ code: "unavailable" }, 404);
      }
      return json(result);
    } catch (error) {
      return json(
        {
          code:
            error instanceof RequestError || error instanceof SlackError
              ? error.code
              : "unavailable",
        },
        error instanceof RequestError
          ? error.status
          : error instanceof SlackError
            ? 400
            : 503,
      );
    }
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const raw =
        request.headers
          .get("Sec-WebSocket-Protocol")
          ?.split(",")
          .map((p) => p.trim())
          .find((p) => p.startsWith("auth."))
          ?.slice(5) ?? null;
      const capability = parseCapability(raw);
      if (!capability) throw new RequestError(404, "unavailable");
      const role = await this.authenticate(capability.secret);
      const record = this.read();
      if (!record || Date.now() >= record.expiresAt)
        throw new RequestError(404, "unavailable");
      if (this.ctx.getWebSockets().length >= 64)
        throw new RequestError(429, "rate_limited");
      if (advance(record, Date.now())) {
        this.save(record);
        this.broadcast(record);
      }
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        role,
        window: Date.now(),
        messages: 0,
      } satisfies Attachment);
      server.send(JSON.stringify(this.message(record, role)));
      await this.ctx.storage.setAlarm(nextDeadline(record));
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "Sec-WebSocket-Protocol": "bierrad" },
      });
    } catch (error) {
      return json(
        {
          code:
            error instanceof RequestError || error instanceof SlackError
              ? error.code
              : "unavailable",
        },
        error instanceof RequestError
          ? error.status
          : error instanceof SlackError
            ? 400
            : 503,
      );
    }
  }
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt) {
      await this.expire();
      return;
    }
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment) {
      ws.close(4003, "unavailable");
      return;
    }
    if (Date.now() - attachment.window >= 60000) {
      attachment.window = Date.now();
      attachment.messages = 0;
    }
    if (
      ++attachment.messages > 12 ||
      typeof raw !== "string" ||
      raw.length > 256
    ) {
      ws.close(4008, "rate_limited");
      return;
    }
    ws.serializeAttachment(attachment);
    try {
      const message: unknown = JSON.parse(raw);
      if (
        !message ||
        typeof message !== "object" ||
        !("type" in message) ||
        message.type !== "ping" ||
        Object.keys(message).length !== 1
      ) {
        ws.send(JSON.stringify({ type: "error", code: "forbidden" }));
        return;
      }
      if (advance(record, Date.now())) {
        this.save(record);
        this.broadcast(record);
      }
      ws.send(JSON.stringify({ type: "pong", serverNow: Date.now() }));
      await this.ctx.storage.setAlarm(nextDeadline(record));
    } catch {
      ws.send(JSON.stringify({ type: "error", code: "invalid" }));
    }
  }
  webSocketClose(ws: WebSocket) {
    ws.close();
  }
  webSocketError(ws: WebSocket) {
    ws.close(1011, "unavailable");
  }
  async alarm() {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt) {
      await this.expire();
      return;
    }
    if (advance(record, Date.now())) {
      this.save(record);
      this.broadcast(record);
    }
    if (record.slack?.importing && record.slack.importing.until <= Date.now()) {
      delete record.slack.importing;
      record.revision++;
      this.save(record);
      this.broadcast(record);
    }
    const jobs = new SessionSlackJobs(this.env, this.ctx, () => this.read(), r => this.save(r), r => this.broadcast(r));
    await jobs.processChannelReminder();
    await this.processChannelRefresh();
    await jobs.processBierfeestNotice();
    await this.processScheduledDraw();
    await jobs.processSlackResult();
    await jobs.processReview();
    await jobs.processCallCard();
    const latest = this.read();
    if (latest && Date.now() < latest.expiresAt)
      await this.ctx.storage.setAlarm(nextDeadline(latest));
  }
  private async processChannelRefresh() {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt) return;
    const at = channelRefreshAt(record);
    if (at === undefined || at > Date.now()) return;
    try {
      // Slack errors are absorbed inside and push the next attempt back.
      await this.importSlack(record);
    } catch {
      // Refused before any Slack call (for example revoked access): back off.
      const current = this.read();
      if (current?.slack && Date.now() < current.expiresAt) {
        current.slack.nextImportAt = Date.now() + 60000;
        this.save(current);
      }
    }
  }
  private async processScheduledDraw() {
    let record = this.read();
    if (!record || Date.now() >= record.expiresAt) return;
    const plan = record.scheduledDraw;
    if (!plan || plan.status === "skipped") return;
    if (plan.status === "refreshing") {
      if ((record.scheduleCheckUntil ?? 0) <= Date.now()) {
        executeScheduledDraw(record, Date.now(), false);
        this.save(record);
        this.broadcast(record);
      }
      return;
    }
    if (Date.now() < Date.parse(plan.startAt) - START_DELAY_MS) return;
    record.scheduledDraw = { ...plan, status: "refreshing" };
    record.scheduleCheckUntil = Date.now() + 120000;
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    record = this.read();
    if (
      !record ||
      Date.now() >= record.expiresAt ||
      record.scheduledDraw?.status !== "refreshing" ||
      record.scheduledDraw.startAt !== plan.startAt
    )
      return;
    let ready = Date.now() <= Date.parse(plan.startAt) + 60000;
    if (ready && record.slack?.source) {
      try {
        // One separately rate-limited final check, even after a recent normal refresh.
        ready = await this.importSlack(record, true);
      } catch {
        ready = false;
      }
    }
    record = this.read();
    if (!record || Date.now() >= record.expiresAt) return;
    if (
      record.scheduledDraw?.status !== "refreshing" ||
      record.scheduledDraw.startAt !== plan.startAt
    )
      return;
    const authorized =
      !record.slack?.source ||
      slackAllowed(
        record.slack.grantHash,
        slackEnvironment(this.env, record.variant),
      );
    executeScheduledDraw(record, Date.now(), ready && authorized);
    this.save(record);
    this.broadcast(record);
    await this.openRoundReview();
  }
  /** Freezes who may review whom, under pseudonyms, as the draw starts. */
  private async openRoundReview() {
    let record = this.read();
    const key = record?.review?.key;
    if (!record || record.review?.status !== "waiting" || !key) return;
    if (!record.session.activeDraw) {
      // Skipped round: nothing to review, and the key goes now.
      delete record.review;
      this.save(record);
      return;
    }
    const ids = Object.keys(record.slack?.mapping ?? {});
    const pseudonyms = new Map(
      await Promise.all(
        ids.map(async (id) => [id, await pseudonym(key, id)] as const),
      ),
    );
    record = this.read();
    if (!record || record.review?.status !== "waiting") return;
    openReview(record, pseudonyms);
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
  }
  /** For a personal channel link: whether this person joined, and their ballot. */
  async memberRound(
    member: string,
  ): Promise<{ participating?: boolean; ballot?: ReviewBallot }> {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt) return {};
    const ballot = reviewBallot(record, member, Date.now());
    if (ballot) return { participating: true, ballot };
    // Before the draw only: the round's own key.
    const key =
      record.review?.status === "waiting" ? record.review.key : undefined;
    if (!key) return {};
    for (const id of Object.keys(record.slack?.mapping ?? {}))
      if (equalHash(await pseudonym(key, id), member))
        return { participating: true };
    return { participating: false };
  }
  /** One ballot per person; closes the review as soon as everyone voted. */
  async submitRoundReview(
    member: string,
    drawId: unknown,
    submission: unknown,
  ): Promise<{ code?: string; status?: number }> {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt)
      return { status: 409, code: "review_closed" };
    try {
      if (submitReview(record, member, drawId, submission, Date.now()))
        closeReview(record, Date.now());
    } catch (error) {
      return error instanceof RequestError
        ? { status: error.status, code: error.code }
        : { status: 503, code: "unavailable" };
    }
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    return {};
  }
  /**
   * Re-reads the call's reactions. Only the server calls this, for channel
   * rounds; resolves whether the participants are now current.
   */
  private async importSlack(
    record: StoredSession,
    finalCheck = false,
  ): Promise<boolean> {
    if (
      !slackAllowed(
        record.slack?.grantHash,
        slackEnvironment(this.env, record.variant),
      )
    )
      throw new RequestError(403, "forbidden");
    if (!getCapabilities("host", record.session).canManageParticipants)
      throw new RequestError(409, "not_ready");
    if (!finalCheck && record.scheduledDraw?.status === "refreshing")
      throw new RequestError(409, "not_ready");
    const state = record.slack!;
    if (
      (state.importing?.until ?? 0) > Date.now() ||
      (state.retryImportAt ?? 0) > Date.now() ||
      (finalCheck
        ? (state.nextFinalImportAt ?? 0)
        : (state.nextImportAt ?? 0)) > Date.now()
    )
      throw new RequestError(429, "slack_rate_limited");
    const source = state.source;
    if (!source) throw new RequestError(400, "slack_link");
    // A goal that joins meanwhile changes what to read; this read then waits.
    const goalCount = record.goals?.length ?? 1;
    const id = crypto.randomUUID();
    state.importing = { id, until: Date.now() + 120000 };
    state.nextImportAt = Date.now() + refreshInterval(record, Date.now());

    if (finalCheck) state.nextFinalImportAt = Date.now() + 60000;
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    try {
      const people = await new SlackReactionParticipantSource(
        new SlackApiClient(
          slackEnvironment(this.env, record.variant).SLACK_BOT_TOKEN!,
        ),
      ).getParticipants(source, state.excludeUserIds, roundReactions(record));
      const current = this.read();
      if (
        !current ||
        Date.now() >= current.expiresAt ||
        current.slack?.importing?.id !== id ||
        !slackAllowed(
          current.slack.grantHash,
          slackEnvironment(this.env, current.variant),
        )
      )
        throw new RequestError(409, "unavailable");
      if ((current.goals?.length ?? 1) !== goalCount) {
        delete current.slack.importing;
        current.slack.nextImportAt = Date.now();
        delete current.slack.retryImportAt;
        current.revision++;
        this.save(current);
        await this.ctx.storage.setAlarm(nextDeadline(current));
        return false;
      }
      reconcile(current, source, people, Date.now());
      queueBierfeestNotice(current, Date.now());
      delete current.slack.importing;
      current.revision++;
      this.save(current);
      this.broadcast(current);
      await this.ctx.storage.setAlarm(nextDeadline(current));
      return Date.now() < current.expiresAt;
    } catch (error) {
      const current = this.read();
      if (
        current &&
        Date.now() < current.expiresAt &&
        current.slack?.importing?.id === id
      ) {
        delete current.slack.importing;
        current.slack.nextImportAt = Math.max(
          current.slack.nextImportAt ?? 0,
          Date.now() +
            (error instanceof SlackError ? error.retryAfterMs : 60000),
        );
        current.slack.retryImportAt = current.slack.nextImportAt;
        current.revision++;
        this.save(current);
        this.broadcast(current);
        await this.ctx.storage.setAlarm(nextDeadline(current));
      }
      return false;
    }
  }

}
