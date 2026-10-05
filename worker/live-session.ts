import type { ChannelVariant } from "../shared/channel";
import { themes, type WheelVariant } from "../shared/variant";
import { SlackApiClient, SlackError } from "./slack/api";
import {
  SlackReactionParticipantSource,
  parseSlackPermalink,
  type SlackSource,
} from "./slack/source";
import {
  reconcile,
  postResult,
  postReminder,
  reminderBody,
  MAX_REMINDER_POSTS,
} from "./slack/state";
import {
  CHANNEL_GRANT,
  slackAllowed,
  slackCeiling,
  slackEnvironment,
  type SlackSecrets,
} from "./slack/access";
import { getCapabilities } from "../src/domain/capabilities";
import { DurableObject } from "cloudflare:workers";
import { equalHash, hashSecret, parseCapability, randomHex } from "./auth";
import { createSession } from "../src/domain/drawEngine";
import { SCHEDULE_RETENTION_MS } from "../shared/retention";
import {
  advance,
  channelRefreshAt,
  executeScheduledDraw,
  START_DELAY_MS,
  mutate,
  newSession,
  nextDeadline,
  publicSession,
  RequestError,
  type StoredSession,
} from "./session";
import { frontend, json } from "./http";
import { ratingLocator } from "./rating-utils";
import { type RatingSettings, type RatingBallot } from "../shared/ratings";
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
    grant?: { hash: string; expiresAt: number; teamId?: string },
    variant: WheelVariant = "beer",
  ): Promise<string> {
    if (this.read()) throw new Error("unavailable");
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS session (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), value TEXT NOT NULL)",
    );
    const record = newSession(hostHash, spectatorHash, Date.now(), variant);
    if (grant) {
      record.slack = {
        grantHash: grant.hash,
        grantExpiresAt: grant.expiresAt,
        mapping: {},
        ...(grant.teamId ? { teamId: grant.teamId } : {}),
      };
      record.expiresAt = Math.min(record.expiresAt, grant.expiresAt);
    }
    this.save(record);
    await this.ctx.storage.setAlarm(record.expiresAt);
    return new Date(record.expiresAt).toISOString();
  }
  /**
   * A coffee or water round of a channel-bound Koffierad: spectators only, one winner, the Slack
   * call message as source and a fixed start. Nobody receives host rights.
   */
  async initializeChannelRound(
    spectatorHash: string,
    source: SlackSource,
    startAt: number,
    excludeUserIds: string[],
    variant: ChannelVariant = "coffee",
    ratingSettings?: RatingSettings,
    teamId?: string,
  ): Promise<void> {
    const hostHash = await hashSecret(randomHex());
    if (this.read()) throw new Error("unavailable");
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS session (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), value TEXT NOT NULL)",
    );
    const now = Date.now();
    const record = newSession(hostHash, spectatorHash, now, variant);
    record.preferredCount = 1;
    record.session = createSession(record.session.id, [], 1);
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
      ...(teamId ? { teamId } : {}),
    };
    if (ratingSettings) record.ratingSettings = { ...ratingSettings };
    this.save(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
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
      session: {
        ...publicSession(record),
        ...(role === "host" && record.slack
          ? {
              slack: {
                enabled: slackAllowed(
                  record.slack.grantHash,
                  slackEnvironment(this.env, record.variant),
                ),
                source: record.slack.source
                  ? ("slack" as const)
                  : ("manual" as const),
                importing:
                  !!record.slack.importing &&
                  record.slack.importing.until > Date.now(),
                count: record.slack.count,
                syncedAt: record.slack.syncedAt,
                ...(record.slack.job
                  ? {
                      result: {
                        drawId: record.slack.job.drawId,
                        status: record.slack.job.status,
                        ...(record.slack.job.status === "failed"
                          ? { retryAt: record.slack.job.retryAt }
                          : {}),
                      },
                    }
                  : {}),
                ...(record.slack.reminder
                  ? {
                      reminder: {
                        startAt: record.slack.reminder.startAt,
                        status: record.slack.reminder.status,
                      },
                    }
                  : {}),
              },
            }
          : {}),
      },
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
      // Hash an offered spectator link up front, so no await separates the
      // read below from the comparison and mutation.
      const offered =
        command &&
        typeof command === "object" &&
        "spectatorCapability" in command &&
        typeof command.spectatorCapability === "string"
          ? command.spectatorCapability
          : undefined;
      const parsed = parseCapability(offered ?? null);
      const offeredHash = parsed ? await hashSecret(parsed.secret) : undefined;
      const role = await this.authenticate(secret);
      if (
        command &&
        typeof command === "object" &&
        "type" in command &&
        command.type === "setRatings"
      ) {
        const before = this.read();
        if (
          role !== "host" ||
          !before ||
          !slackAllowed(
            before.slack?.grantHash,
            slackEnvironment(this.env, before.variant),
          )
        )
          throw new RequestError(403, "ratings_slack_required");
        // Legacy sessions learn their workspace only after an authenticated host opts in.
        if (!before.slack!.teamId) {
          const workspace = await new SlackApiClient(
            slackEnvironment(this.env, before.variant).SLACK_BOT_TOKEN!,
          ).call("auth.test", {});
          const latest = this.read();
          if (
            !latest ||
            Date.now() >= latest.expiresAt ||
            typeof workspace.team_id !== "string" ||
            !/^T[A-Z0-9]{8,20}$/.test(workspace.team_id)
          )
            throw new RequestError(404, "unavailable");
          latest.slack!.teamId = workspace.team_id;
          this.save(latest);
        }
      }
      // Re-read after the await, protecting concurrent requests/expiry.
      const record = this.read();
      if (!record || Date.now() >= record.expiresAt)
        throw new RequestError(404, "unavailable");
      const advanced = advance(record, Date.now());
      if (advanced) {
        this.save(record);
        this.broadcast(record);
      }
      if (
        command &&
        typeof command === "object" &&
        "type" in command &&
        command.type === "slackImport"
      ) {
        return await this.importSlack(record, role, command);
      }
      if (
        command &&
        typeof command === "object" &&
        "type" in command &&
        command.type === "slackRetry" &&
        !slackAllowed(
          record.slack?.grantHash,
          slackEnvironment(this.env, record.variant),
        )
      )
        throw new RequestError(403, "forbidden");
      if (
        command &&
        typeof command === "object" &&
        "type" in command &&
        command.type === "setScheduledDraw" &&
        "startAt" in command &&
        command.startAt !== null &&
        record.slack
      ) {
        if (role !== "host") throw new RequestError(403, "forbidden");
        const ceiling = slackCeiling(
          record.slack,
          slackEnvironment(this.env, record.variant),
        );
        if (ceiling === undefined)
          throw new RequestError(403, "schedule_access_expires");
      }
      if (command !== null) {
        mutate(
          record,
          role,
          command,
          Date.now(),
          offeredHash && equalHash(offeredHash, record.spectatorHash)
            ? offered
            : undefined,
        );
        this.save(record);
      }
      if (
        command &&
        typeof command === "object" &&
        "type" in command &&
        ["setRatings", "setParticipants", "startDraw", "reset"].includes(
          String(command.type),
        )
      ) {
        await this.refreshRatings();
        const latest = this.read();
        if (!latest || Date.now() >= latest.expiresAt)
          throw new RequestError(404, "unavailable");
        this.broadcast(latest);
        await this.ctx.storage.setAlarm(nextDeadline(latest));
        if (Date.now() >= latest.expiresAt) {
          await this.expire();
          throw new RequestError(404, "unavailable");
        }
        return json(this.message(latest, role));
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
    await this.processSlackReminder();
    await this.processChannelRefresh();
    await this.processScheduledDraw();
    await this.processSlackResult();
    const latest = this.read();
    if (latest && Date.now() < latest.expiresAt)
      await this.ctx.storage.setAlarm(nextDeadline(latest));
  }
  /** Same claim-before-I/O discipline as results; ambiguous posts never repeat. */
  private async processSlackReminder() {
    const record = this.read();
    const reminder = record?.slack?.reminder;
    if (!record || Date.now() >= record.expiresAt || !reminder) return;
    const settle = (target: StoredSession, status = reminder.status) => {
      const r = target.slack!.reminder!;
      r.status = status;
      delete r.capability;
      delete r.retryAt;
      target.revision++;
      this.save(target);
      this.broadcast(target);
    };
    if (reminder.status === "posting") {
      if (Date.now() >= reminder.attemptedAt! + 120000)
        settle(record, "uncertain");
      return;
    }
    const due =
      reminder.status === "pending"
        ? reminder.readyAt
        : reminder.status === "failed" && reminder.capability
          ? (reminder.retryAt ?? Infinity)
          : Infinity;
    if (due > Date.now()) return;
    const slack = record.slack!;
    const env = slackEnvironment(this.env, record.variant);
    const app = frontend(this.env);
    if (
      Date.now() >= Date.parse(reminder.startAt) ||
      !slack.source ||
      !reminder.capability ||
      !app ||
      (slack.reminderPosts ?? 0) >= MAX_REMINDER_POSTS ||
      !slackAllowed(slack.grantHash, env)
    ) {
      settle(record, reminder.status === "pending" ? "skipped" : "failed");
      return;
    }
    const body = reminderBody(
      slack.source,
      record.variant ?? "beer",
      `${app.href}#/live/${reminder.capability}`,
      reminder.startAt,
      Date.now(),
    );
    const id = reminder.id;
    // Claim synchronously before any await. Persist + arm crash recovery before external I/O.
    reminder.status = "posting";
    reminder.attemptedAt = Date.now();
    reminder.attempts++;
    slack.reminderPosts = (slack.reminderPosts ?? 0) + 1;
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    await this.ctx.storage.sync();
    const current = this.read();
    if (
      !current ||
      Date.now() >= current.expiresAt ||
      current.slack?.reminder?.id !== id ||
      current.slack.reminder.status !== "posting"
    )
      return;
    if (
      !slackAllowed(
        current.slack.grantHash,
        slackEnvironment(this.env, current.variant),
      )
    ) {
      settle(current, "failed");
      return;
    }
    const result = await postReminder(
      new SlackApiClient(env.SLACK_BOT_TOKEN!),
      body,
    );
    const latest = this.read();
    const r = latest?.slack?.reminder;
    if (
      !latest ||
      Date.now() >= latest.expiresAt ||
      r?.id !== id ||
      r.status !== "posting"
    )
      return;
    // A definite rejection gets one automatic retry, but only before the start.
    if (
      result.status === "failed" &&
      r.attempts < 2 &&
      result.retryAt < Date.parse(r.startAt)
    ) {
      r.status = "failed";
      r.retryAt = result.retryAt;
      latest.revision++;
      this.save(latest);
      this.broadcast(latest);
      return;
    }
    settle(latest, result.status);
  }
  private async processChannelRefresh() {
    const record = this.read();
    if (!record || Date.now() >= record.expiresAt) return;
    const at = channelRefreshAt(record);
    if (at === undefined || at > Date.now()) return;
    try {
      // Slack errors are absorbed inside and push the next attempt back.
      await this.importSlack(record, "host", {
        type: "slackImport",
        revision: record.revision,
      });
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
        const result = await this.importSlack(
          record,
          "host",
          {
            type: "slackImport",
            revision: record.revision,
          },
          true,
        );
        ready = result.ok;
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
  }
  private async importSlack(
    record: StoredSession,
    role: ClientRole,
    raw: object,
    finalCheck = false,
  ): Promise<Response> {
    const command = raw as Record<string, unknown>;
    if (
      role !== "host" ||
      !slackAllowed(
        record.slack?.grantHash,
        slackEnvironment(this.env, record.variant),
      )
    )
      throw new RequestError(403, "forbidden");
    if (
      Object.keys(command).some(
        (k) => !["type", "revision", "permalink"].includes(k),
      ) ||
      ("permalink" in command && typeof command.permalink !== "string")
    )
      throw new RequestError(400, "invalid");
    if (
      command.revision !== record.revision ||
      !getCapabilities(role, record.session).canManageParticipants
    )
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
    const source =
      command.permalink !== undefined
        ? parseSlackPermalink(
            command.permalink,
            themes[record.variant ?? "beer"].reaction,
          )
        : state.source;
    if (!source) throw new RequestError(400, "slack_link");
    const id = crypto.randomUUID();
    state.importing = { id, until: Date.now() + 120000 };
    state.nextImportAt = Date.now() + 60000;
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
      ).getParticipants(source, state.excludeUserIds);
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
      reconcile(current, source, people, Date.now());
      delete current.slack.importing;
      current.revision++;
      this.save(current);
      this.broadcast(current);
      await this.refreshRatings();
      const latest = this.read();
      if (!latest || Date.now() >= latest.expiresAt)
        throw new RequestError(404, "unavailable");
      const result = this.message(latest, role);
      await this.ctx.storage.setAlarm(nextDeadline(latest));
      if (Date.now() >= current.expiresAt)
        throw new RequestError(404, "unavailable");
      return json(result);
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
      return json(
        {
          code:
            error instanceof SlackError
              ? error.code
              : error instanceof RequestError
                ? error.code
                : "slack_unavailable",
        },
        error instanceof SlackError && error.code === "slack_rate_limited"
          ? 429
          : 400,
      );
    }
  }
  private ratingRecord() {
    const record = this.read();
    if (
      !record ||
      Date.now() >= record.expiresAt ||
      !record.slack?.teamId ||
      !slackAllowed(
        record.slack.grantHash,
        slackEnvironment(this.env, record.variant),
      )
    )
      throw new RequestError(404, "unavailable");
    return record;
  }
  /** Authorized navigation into OAuth; the session capability travels only in a POST body. */
  async ratingLogin(secret: string, drawId: string): Promise<WheelVariant> {
    await this.authenticate(secret);
    const record = this.ratingRecord();
    const round = record.ratingRounds?.find((r) => r.drawId === drawId);
    if (!round || Date.now() < Date.parse(round.opensAt))
      throw new RequestError(409, "not_ready");
    return record.variant ?? "beer";
  }
  /** Called only after the Worker verifies the OIDC identity and workspace. */
  async ratingGrant(
    drawId: string,
    teamId: string,
    userId: string,
  ): Promise<string> {
    const secret = randomHex();
    const hash = await hashSecret(secret);
    const record = this.ratingRecord();
    const round = record.ratingRounds?.find((r) => r.drawId === drawId);
    if (
      teamId !== record.slack!.teamId ||
      !round?.electorate.includes(userId) ||
      Date.now() < Date.parse(round.opensAt)
    )
      throw new RequestError(403, "forbidden");
    (record.ratingGrants ??= {})[`${drawId}:${userId}`] = { hash, drawId };
    this.save(record);
    return secret;
  }
  async ratingAccess(secret: string, input: unknown): Promise<Response> {
    try {
      const hash = await hashSecret(secret);
      const record = this.ratingRecord();
      const entry = Object.entries(record.ratingGrants ?? {}).find(
        ([, grant]) => equalHash(grant.hash, hash),
      );
      if (!entry) throw new RequestError(404, "unavailable");
      const [key, grant] = entry;
      const voter = key.slice(grant.drawId.length + 1);
      const round = record.ratingRounds?.find((r) => r.drawId === grant.drawId);
      if (
        !round ||
        !round.electorate.includes(voter) ||
        Date.now() < Date.parse(round.opensAt)
      )
        throw new RequestError(403, "forbidden");
      const ballotId = await hashSecret(
        `bierrad-ballot:${record.session.id}:${round.drawId}:${voter}`,
      );
      const store = this.env.RATINGS.getByName(
        await ratingLocator(record.slack!.teamId!, record.variant ?? "beer"),
      );
      let submitted: boolean;
      if (input !== null) {
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).length !== 1 ||
          !("scores" in input) ||
          !Array.isArray(input.scores) ||
          input.scores.length !== round.winners.length
        )
          throw new RequestError(400, "invalid");
        const ids = new Set<string>();
        const votes = input.scores.map((score: unknown) => {
          if (
            !score ||
            typeof score !== "object" ||
            Object.keys(score).length !== 2 ||
            !("winnerId" in score) ||
            !("stars" in score) ||
            typeof score.winnerId !== "string" ||
            !round.winners.some((w) => w.id === score.winnerId) ||
            ids.has(score.winnerId) ||
            typeof score.stars !== "number" ||
            !Number.isInteger(score.stars) ||
            score.stars < 1 ||
            score.stars > 5
          )
            throw new RequestError(400, "invalid");
          ids.add(score.winnerId);
          return {
            person: round.identities[score.winnerId],
            stars: score.stars,
          };
        });
        // Recheck revocation after asynchronous hashing/RPC preparation.
        const latest = this.ratingRecord();
        if (latest.ratingGrants?.[key]?.hash !== hash)
          throw new RequestError(404, "unavailable");
        // A host may extend a still-valid session later. Keep the opaque claim
        // through its fixed Slack ceiling so extension cannot reopen a used ballot.
        await store.vote(
          ballotId,
          votes,
          latest.expiresAt,
          latest.slack!.grantExpiresAt ?? latest.expiresAt,
        );
        submitted = true; // Duplicate delivery is an idempotent success.
        await this.refreshRatings();
      } else submitted = await store.hasBallot(ballotId);
      const latest = this.ratingRecord();
      if (latest.ratingGrants?.[key]?.hash !== hash)
        throw new RequestError(404, "unavailable");
      return json({
        variant: record.variant ?? "beer",
        round: {
          drawId: round.drawId,
          opensAt: round.opensAt,
          winners: round.winners.map((w) => ({ id: w.id, name: w.name })),
        },
        expiresAt: new Date(latest.expiresAt).toISOString(),
        submitted,
        serverNow: Date.now(),
      } satisfies RatingBallot);
    } catch (error) {
      return json(
        { code: error instanceof RequestError ? error.code : "unavailable" },
        error instanceof RequestError ? error.status : 503,
      );
    }
  }
  private async refreshRatings() {
    const before = this.read();
    if (
      !before?.ratingSettings?.enabled ||
      !before.slack?.teamId ||
      Date.now() >= before.expiresAt
    )
      return;
    const mapping = { ...before.slack.mapping };
    const summaries = await this.env.RATINGS.getByName(
      await ratingLocator(before.slack.teamId, before.variant ?? "beer"),
    ).summaries(Object.keys(mapping));
    const latest = this.read();
    if (
      !latest?.ratingSettings?.enabled ||
      Date.now() >= latest.expiresAt ||
      latest.slack?.teamId !== before.slack.teamId
    )
      return;
    const byParticipant = new Map(
      Object.entries(mapping)
        .filter(([user, id]) => latest.slack!.mapping[user] === id)
        .map(([user, id]) => [id, summaries[user]]),
    );
    latest.session = {
      ...latest.session,
      participants: latest.session.participants.map((p) =>
        byParticipant.has(p.id) ? { ...p, rating: byParticipant.get(p.id) } : p,
      ),
    };
    latest.revision++;
    this.save(latest);
    this.broadcast(latest);
  }
  private async processSlackResult() {
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
}
