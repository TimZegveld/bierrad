import { SlackApiClient, SlackError } from "./slack/api";
import {
  SlackReactionParticipantSource,
  parseSlackPermalink,
} from "./slack/source";
import { reconcile, postResult } from "./slack/state";
import { slackAllowed, type SlackSecrets } from "./slack/access";
import { getCapabilities } from "../src/domain/capabilities";
import { DurableObject } from "cloudflare:workers";
import { equalHash, hashSecret, parseCapability } from "./auth";
import {
  advance,
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
    grant?: { hash: string; expiresAt: number },
  ): Promise<string> {
    if (this.read()) throw new Error("unavailable");
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS session (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), value TEXT NOT NULL)",
    );
    const record = newSession(hostHash, spectatorHash, Date.now());
    if (grant) {
      record.slack = { grantHash: grant.hash, mapping: {} };
      record.expiresAt = Math.min(record.expiresAt, grant.expiresAt);
    }
    this.save(record);
    await this.ctx.storage.setAlarm(record.expiresAt);
    return new Date(record.expiresAt).toISOString();
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
                enabled: slackAllowed(record.slack.grantHash, this.env),
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
        !slackAllowed(record.slack?.grantHash, this.env)
      )
        throw new RequestError(403, "forbidden");
      if (command !== null) {
        mutate(record, role, command, Date.now());
        this.save(record);
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
    await this.processSlackResult();
    const latest = this.read();
    if (latest && Date.now() < latest.expiresAt)
      await this.ctx.storage.setAlarm(nextDeadline(latest));
  }
  private async importSlack(
    record: StoredSession,
    role: ClientRole,
    raw: object,
  ): Promise<Response> {
    const command = raw as Record<string, unknown>;
    if (role !== "host" || !slackAllowed(record.slack?.grantHash, this.env))
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
    const state = record.slack!;
    if (
      (state.importing?.until ?? 0) > Date.now() ||
      (state.nextImportAt ?? 0) > Date.now()
    )
      throw new RequestError(429, "slack_rate_limited");
    const source =
      command.permalink !== undefined
        ? parseSlackPermalink(command.permalink)
        : state.source;
    if (!source) throw new RequestError(400, "slack_link");
    const id = crypto.randomUUID();
    state.importing = { id, until: Date.now() + 120000 };
    state.nextImportAt = Date.now() + 60000;
    record.revision++;
    this.save(record);
    this.broadcast(record);
    await this.ctx.storage.setAlarm(nextDeadline(record));
    try {
      const people = await new SlackReactionParticipantSource(
        new SlackApiClient(this.env.SLACK_BOT_TOKEN!),
      ).getParticipants(source);
      const current = this.read();
      if (
        !current ||
        Date.now() >= current.expiresAt ||
        current.slack?.importing?.id !== id ||
        !slackAllowed(current.slack.grantHash, this.env)
      )
        throw new RequestError(409, "unavailable");
      reconcile(current, source, people, Date.now());
      delete current.slack.importing;
      current.revision++;
      this.save(current);
      this.broadcast(current);
      const result = this.message(current, role);
      await this.ctx.storage.setAlarm(nextDeadline(current));
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
    if (!slackAllowed(record.slack!.grantHash, this.env)) {
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
      !slackAllowed(current.slack?.grantHash, this.env)
    )
      return;
    const result = await postResult(
      new SlackApiClient(this.env.SLACK_BOT_TOKEN!),
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
