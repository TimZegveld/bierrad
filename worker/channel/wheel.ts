import { DurableObject } from "cloudflare:workers";
import {
  CHANNEL_IDLE_TTL_MS,
  channelCopy,
  DEFAULT_ROUND_MINUTES,
  isChannelVariant,
  MAX_ROUNDS_PER_DAY,
  roundStartAt,
  validRoundMinutes,
  type ChannelCommandResult,
  type ChannelStatus,
  type ChannelVariant,
} from "../../shared/channel";
import { themes } from "../../shared/variant";
import {
  equalHash,
  hashSecret,
  randomHex,
  randomWords,
  wordLocator,
} from "../auth";
import { frontend, json } from "../http";
import { RequestError } from "../session";
import { validRatingSettings, type RatingSettings } from "../../shared/ratings";
import { SlackApiClient } from "../slack/api";
import {
  loginConfigured,
  slackEnvironment,
  type SlackSecrets,
} from "../slack/access";
import { postMessage } from "../slack/state";
import { boundBody, callBody } from "./messages";
import { slashHelp, validChannelName } from "./slash";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A round can be watched until this long after its start; it stops blocking once drawn. */
export const ROUND_WATCH_MS = 3 * 60 * 1000;

interface Round {
  id: string;
  /** Absent on rounds from before water; those are coffee. */
  variant?: ChannelVariant;
  status: "posting" | "open";
  startAt: number;
  endsAt: number;
  /**
   * Raw spectator capability of the round, also posted in the channel. Kept
   * server-side only until the round can no longer be watched.
   */
  spectatorCapability: string;
}
interface Binding {
  ratingSettings?: RatingSettings;
  locator: string;
  channelId: string;
  teamId: string;
  /** The bot's own user; its prefilled reaction never counts. */
  botUserId?: string;
  adminHash: string;
  requestHash: string;
  /**
   * Raw request capability, already posted in the channel itself. Kept so every
   * call can link to the fixed channel page; never returned in any DTO.
   * Absent on bindings made before the fixed link; they link per round instead.
   */
  requestCapability?: string;
  /** Hash of the channel's view-only word link. */
  viewerHash?: string;
  /**
   * Raw view-only word link, shown to request link holders so it can be typed
   * on another screen. Absent on bindings made before it; rotation adds one.
   */
  viewerCapability?: string;
  /** Last channel name Slack sent with a signed `/koffierad` or `/waterrad`; display only. */
  channelName?: string;
  /** What the latest round fetched, so an idle screen keeps its theme. */
  lastVariant?: ChannelVariant;
  defaultMinutes: number;
  createdAt: number;
  /** Idle expiry, pushed back by binding and by every round. */
  expiresAt: number;
  window: number;
  rounds: number;
  round?: Round;
}
export interface BindInput {
  locator: string;
  channelId: string;
  teamId: string;
  botUserId?: string;
  adminHash: string;
  requestHash: string;
  requestCapability: string;
}
/**
 * One Durable Object per channel. The name is derived from the channel so
 * slash commands find it; like every locator it grants nothing by itself.
 */
export async function channelLocator(channelId: string): Promise<string> {
  return (await hashSecret(`koffierad-channel:${channelId}`)).slice(0, 32);
}
/**
 * Word links carry no locator, so each gets a pointer object named after it
 * that only knows which channel to ask; the channel checks the hash.
 */
export async function channelViewerLocator(words: string): Promise<string> {
  return (await hashSecret(`koffierad-viewer:${words}`)).slice(0, 32);
}
/**
 * Ephemeral replies for a refused `/koffierad` or `/waterrad`. A busy channel
 * names the round that is running, which may be of the other kind.
 */
function roundError(
  code: string,
  requested: ChannelVariant,
  running: ChannelVariant,
): string | undefined {
  const icon = themes[requested].icon;
  switch (code) {
    case "round_active":
      return `${themes[running].icon} Er loopt al een ${channelCopy[running].round} in dit kanaal. Klik op ${themes[running].icon} onder de oproep om mee te doen.`;
    case "round_limit":
      return `${icon} Vandaag zijn er al genoeg rondes gestart in dit kanaal. Morgen weer!`;
    case "slack_post_failed":
      return `${icon} Het Koffierad kon niet in dit kanaal posten. Nodig de Koffierad-bot uit met /invite @Koffierad en probeer opnieuw.`;
    case "slack_uncertain":
      return `${icon} Het is onzeker of de oproep is geplaatst. Kijk even in het kanaal voordat je het opnieuw probeert.`;
  }
}

export class ChannelWheel extends DurableObject<Env & SlackSecrets> {
  private read(): Binding | undefined {
    if (
      !this.ctx.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE name = 'binding'")
        .toArray().length
    )
      return undefined;
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM binding WHERE singleton = 1")
      .toArray()[0];
    return row ? (JSON.parse(row.value) as Binding) : undefined;
  }
  private save(binding: Binding) {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO binding VALUES (1, ?)",
      JSON.stringify(binding),
    );
  }
  private async expire() {
    const viewer = this.read()?.viewerCapability;
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    if (viewer) await this.dropViewer(viewer);
  }
  private async addViewer(binding: Binding, viewer: string) {
    await this.env.CHANNELS.getByName(await channelViewerLocator(viewer)).point(
      binding.locator,
    );
  }
  private async dropViewer(viewer: string) {
    try {
      await this.env.CHANNELS.getByName(
        await channelViewerLocator(viewer),
      ).unpoint();
    } catch {
      // A stale pointer grants nothing: the channel no longer accepts its hash.
    }
  }
  private async arm(binding: Binding) {
    await this.ctx.storage.setAlarm(
      Math.min(binding.expiresAt, binding.round?.endsAt ?? Infinity),
    );
  }
  private slack() {
    return slackEnvironment(this.env, "coffee");
  }
  /** Rebinding replaces both links (the old ones stop working) but keeps the daily count. */
  async bind(input: BindInput, requestLink: string): Promise<void> {
    const viewer = randomWords();
    const viewerHash = await hashSecret(viewer);
    const env = this.slack();
    if (!loginConfigured(env)) throw new RequestError(503, "unavailable");
    const posted = await postMessage(
      new SlackApiClient(env.SLACK_BOT_TOKEN!),
      input.channelId,
      boundBody(input.channelId, requestLink),
    );
    if (posted.status !== "posted")
      throw new RequestError(
        400,
        posted.status === "failed" ? "not_in_channel" : "unavailable",
      );
    const now = Date.now();
    const stored = this.read();
    const previous = stored && now < stored.expiresAt ? stored : undefined;
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS binding (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), value TEXT NOT NULL)",
    );
    const binding: Binding = {
      locator: input.locator,
      channelId: input.channelId,
      teamId: input.teamId,
      ...(input.botUserId ? { botUserId: input.botUserId } : {}),
      adminHash: input.adminHash,
      requestHash: input.requestHash,
      requestCapability: input.requestCapability,
      viewerHash,
      viewerCapability: viewer,
      ...(previous?.channelName ? { channelName: previous.channelName } : {}),
      defaultMinutes: previous?.defaultMinutes ?? DEFAULT_ROUND_MINUTES,
      ...(previous?.ratingSettings
        ? { ratingSettings: previous.ratingSettings }
        : {}),
      createdAt: now,
      expiresAt: now + CHANNEL_IDLE_TTL_MS,
      window: previous?.window ?? now,
      rounds: previous?.rounds ?? 0,
      ...(previous?.round ? { round: previous.round } : {}),
    };
    this.save(binding);
    await this.arm(binding);
    await this.addViewer(binding, viewer);
    if (stored?.viewerCapability)
      await this.dropViewer(stored.viewerCapability);
  }
  /** Pointer objects only: remember which channel a word link belongs to. */
  async point(channel: string): Promise<void> {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS pointer (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), channel TEXT NOT NULL)",
    );
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO pointer VALUES (1, ?)",
      channel,
    );
  }
  async unpoint(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
  /** Pointer objects only: forwards a view-only word link, never a command. */
  async view(words: string): Promise<Response> {
    const row = this.ctx.storage.sql
      .exec("SELECT name FROM sqlite_master WHERE name = 'pointer'")
      .toArray().length
      ? this.ctx.storage.sql
          .exec<{
            channel: string;
          }>("SELECT channel FROM pointer WHERE singleton = 1")
          .toArray()[0]
      : undefined;
    if (!row) return json({ code: "unavailable" }, 404);
    try {
      const response = await this.env.CHANNELS.getByName(row.channel).watch(
        words,
      );
      // Replaced, unbound or expired: this pointer is useless from now on.
      if (response.status === 404) await this.unpoint();
      return response;
    } catch {
      return json({ code: "unavailable" }, 503);
    }
  }
  /** All a view-only word link may see: the latest round. */
  async watch(words: string): Promise<Response> {
    try {
      const hash = await hashSecret(words);
      const binding = this.read();
      if (!binding?.viewerHash) throw new RequestError(404, "unavailable");
      if (Date.now() >= binding.expiresAt) {
        await this.expire();
        throw new RequestError(404, "unavailable");
      }
      if (!equalHash(hash, binding.viewerHash))
        throw new RequestError(404, "unavailable");
      const settled = await this.settledRoundId();
      const current = this.read();
      if (!current) throw new RequestError(404, "unavailable");
      const { round, channelName, variant } = this.status(
        current,
        "requester",
        Date.now(),
        settled,
      );
      return json({
        type: "view",
        ...(variant ? { variant } : {}),
        ...(channelName ? { channelName } : {}),
        ...(round ? { round } : {}),
      } satisfies ChannelCommandResult);
    } catch (error) {
      return json(
        { code: error instanceof RequestError ? error.code : "unavailable" },
        error instanceof RequestError ? error.status : 503,
      );
    }
  }
  /** The current round's ID once its draw is over, so it no longer blocks the next. */
  private async settledRoundId(): Promise<string | undefined> {
    const round = this.read()?.round;
    if (!round || round.status !== "open") return;
    try {
      const session = this.env.SESSIONS.getByName(
        await wordLocator(round.spectatorCapability),
      );
      return (await session.channelRoundSettled()) ? round.id : undefined;
    } catch {
      return;
    }
  }
  private status(
    binding: Binding,
    role: ChannelStatus["role"],
    now: number,
    settledId?: string,
  ): ChannelStatus {
    const round = binding.round;
    const used = now - binding.window >= DAY_MS ? 0 : binding.rounds;
    const shown = round && round.status === "open" && now < round.endsAt;
    return {
      role,
      variant: (shown ? round.variant : binding.lastVariant) ?? "coffee",
      defaultMinutes: binding.defaultMinutes,
      ...(binding.ratingSettings
        ? { ratingSettings: binding.ratingSettings }
        : {}),
      ...(shown
        ? {
            round: {
              variant: round.variant ?? "coffee",
              startAt: new Date(round.startAt).toISOString(),
              spectatorCapability: round.spectatorCapability,
              // A settled round stays visible (its result) but no longer blocks.
              active: round.id !== settledId,
            },
          }
        : {}),
      roundsLeft: Math.max(0, MAX_ROUNDS_PER_DAY - used),
      expiresAt: new Date(binding.expiresAt).toISOString(),
      ...(binding.viewerCapability
        ? { viewerCapability: binding.viewerCapability }
        : {}),
      ...(binding.channelName ? { channelName: binding.channelName } : {}),
    };
  }
  private async authenticate(secret: string): Promise<ChannelStatus["role"]> {
    const hash = await hashSecret(secret);
    const binding = this.read();
    if (!binding) throw new RequestError(404, "unavailable");
    if (Date.now() >= binding.expiresAt) {
      await this.expire();
      throw new RequestError(404, "unavailable");
    }
    if (equalHash(hash, binding.adminHash)) return "admin";
    if (equalHash(hash, binding.requestHash)) return "requester";
    throw new RequestError(404, "unavailable");
  }
  /** Link holders: status, round requests and (admin only) management. */
  async access(secret: string, command: unknown): Promise<Response> {
    try {
      // Generated before authorization so no await separates read and write below.
      const rotated = randomHex(),
        viewer = randomWords();
      const [rotatedHash, viewerHash] = await Promise.all([
        hashSecret(rotated),
        hashSecret(viewer),
      ]);
      const role = await this.authenticate(secret);
      const settled = await this.settledRoundId();
      if (command === null) {
        const binding = this.read();
        if (!binding) throw new RequestError(404, "unavailable");
        return json({
          type: "status",
          status: this.status(binding, role, Date.now(), settled),
        } satisfies ChannelCommandResult);
      }
      const allowed: Record<string, string[]> = {
        requestRound: ["minutes", "variant", "ratingSettings"],
        setRatingDefaults: ["settings"],
        setDefaultMinutes: ["minutes"],
        rotateRequestLink: [],
        unbind: [],
      };
      if (
        !command ||
        typeof command !== "object" ||
        Array.isArray(command) ||
        !("type" in command) ||
        typeof command.type !== "string" ||
        !Object.hasOwn(allowed, command.type) ||
        Object.keys(command).some(
          (k) => !["type", ...allowed[command.type as string]].includes(k),
        )
      )
        throw new RequestError(400, "invalid");
      const input = command as Record<string, unknown>;
      if (input.type === "requestRound") {
        if (
          !validRoundMinutes(input.minutes) ||
          ("ratingSettings" in input &&
            !validRatingSettings(input.ratingSettings)) ||
          ("variant" in input && !isChannelVariant(input.variant))
        )
          throw new RequestError(400, "invalid");
        await this.startRound(
          input.minutes,
          isChannelVariant(input.variant) ? input.variant : "coffee",
          input.ratingSettings as RatingSettings | undefined,
        );
      } else {
        if (role !== "admin") throw new RequestError(403, "forbidden");
        const binding = this.read();
        if (!binding || Date.now() >= binding.expiresAt)
          throw new RequestError(404, "unavailable");
        if (input.type === "unbind") {
          await this.expire();
          return json({ type: "unbound" } satisfies ChannelCommandResult);
        }
        if (input.type === "setRatingDefaults") {
          if (!validRatingSettings(input.settings))
            throw new RequestError(400, "invalid");
          binding.ratingSettings = { ...input.settings };
          this.save(binding);
        } else if (input.type === "setDefaultMinutes") {
          if (!validRoundMinutes(input.minutes))
            throw new RequestError(400, "invalid");
          binding.defaultMinutes = input.minutes;
          this.save(binding);
        } else {
          // A new channel link also replaces the word link to watch along.
          const previousViewer = binding.viewerCapability;
          binding.requestHash = rotatedHash;
          binding.requestCapability = `${binding.locator}.${rotated}`;
          binding.viewerHash = viewerHash;
          binding.viewerCapability = viewer;
          this.save(binding);
          await this.addViewer(binding, viewer);
          if (previousViewer) await this.dropViewer(previousViewer);
          return json({
            type: "rotated",
            requestCapability: `${binding.locator}.${rotated}`,
            status: this.status(binding, role, Date.now(), settled),
          } satisfies ChannelCommandResult);
        }
      }
      const binding = this.read();
      if (!binding) throw new RequestError(404, "unavailable");
      return json({
        type: "status",
        status: this.status(binding, role, Date.now(), settled),
      } satisfies ChannelCommandResult);
    } catch (error) {
      return json(
        { code: error instanceof RequestError ? error.code : "unavailable" },
        error instanceof RequestError ? error.status : 503,
      );
    }
  }
  /**
   * Called only after the Worker verified Slack's signature for this channel.
   * Resolves to an ephemeral reply, or null on success: the call is the confirmation.
   */
  async slash(
    minutes: number | undefined,
    channelName?: string,
    variant: ChannelVariant = "coffee",
  ): Promise<string | null> {
    const app = frontend(this.env);
    const binding = this.read();
    const icon = themes[variant].icon;
    if (!binding || Date.now() >= binding.expiresAt)
      return `${icon} Dit kanaal heeft nog geen Koffierad.${app ? ` Koppel het via ${app.href}#/koffie-koppelen` : ""}`;
    // Keeps the shown name current when the channel is renamed.
    const name = validChannelName(channelName);
    if (name && name !== binding.channelName) {
      binding.channelName = name;
      this.save(binding);
    }
    const chosen = minutes ?? binding.defaultMinutes;
    if (!validRoundMinutes(chosen)) return slashHelp(variant);
    try {
      await this.startRound(chosen, variant);
      return null;
    } catch (error) {
      return (
        (error instanceof RequestError &&
          roundError(
            error.code,
            variant,
            this.read()?.round?.variant ?? "coffee",
          )) ||
        `${icon} Het Koffierad is nu niet bereikbaar. Probeer het zo opnieuw.`
      );
    }
  }
  /**
   * Claims the round before any Slack call, posts the call, adds the first ☕
   * or 💧 and hands the draw to a fresh spectator-only LiveSession.
   */
  private async startRound(
    minutes: number,
    variant: ChannelVariant,
    requestedRatings?: RatingSettings,
  ): Promise<{ startAt: string; spectatorCapability: string }> {
    const reaction = themes[variant].reaction;
    const spectator = randomWords();
    const [sessionLocator, spectatorHash] = await Promise.all([
      wordLocator(spectator),
      hashSecret(spectator),
    ]);
    const settled = await this.settledRoundId();
    const env = this.slack(),
      app = frontend(this.env);
    const binding = this.read();
    const now = Date.now();
    if (!binding || now >= binding.expiresAt)
      throw new RequestError(404, "unavailable");
    if (!loginConfigured(env) || !app)
      throw new RequestError(503, "unavailable");
    // A round blocks the next until its draw is over (or it can no longer be watched).
    if (
      binding.round &&
      now < binding.round.endsAt &&
      binding.round.id !== settled
    )
      throw new RequestError(409, "round_active");
    if (now - binding.window >= DAY_MS) {
      binding.window = now;
      binding.rounds = 0;
    }
    if (binding.rounds >= MAX_ROUNDS_PER_DAY)
      throw new RequestError(429, "round_limit");
    const startAt = roundStartAt(now, minutes);
    const ratings = requestedRatings ?? binding.ratingSettings;
    const id = crypto.randomUUID();
    binding.round = {
      id,
      variant,
      status: "posting",
      startAt,
      endsAt: startAt + (ratings?.enabled ? 60 * 60000 : ROUND_WATCH_MS),
      spectatorCapability: spectator,
    };
    binding.rounds++;
    binding.lastVariant = variant;
    binding.expiresAt = Math.max(binding.expiresAt, now + CHANNEL_IDLE_TTL_MS);
    this.save(binding);
    await this.arm(binding);
    await this.ctx.storage.sync();
    const clear = () => {
      const current = this.read();
      if (current?.round?.id !== id) return;
      delete current.round;
      this.save(current);
    };
    const api = new SlackApiClient(env.SLACK_BOT_TOKEN!);
    const posted = await postMessage(
      api,
      binding.channelId,
      callBody(
        binding.channelId,
        // The view-only word link follows every round. Older bindings fall back
        // to the fixed channel page, or else link per round.
        binding.viewerCapability
          ? `${app.href}#/koffie/${binding.viewerCapability}`
          : binding.requestCapability
            ? `${app.href}#/koffie/${binding.requestCapability}`
            : `${app.href}#/live/${spectator}`,
        startAt,
        variant,
      ),
    );
    if (posted.status !== "posted") {
      clear();
      throw new RequestError(
        400,
        posted.status === "failed" ? "slack_post_failed" : "slack_uncertain",
      );
    }
    try {
      await api.call("reactions.add", {
        channel: binding.channelId,
        timestamp: posted.postedMessageTs,
        name: reaction,
      });
    } catch {
      // Not essential: people can still add ☕ or 💧 themselves.
    }
    try {
      await this.env.SESSIONS.getByName(sessionLocator).initializeChannelRound(
        spectatorHash,
        {
          channelId: binding.channelId,
          parentMessageTs: posted.postedMessageTs,
          reactionName: reaction,
        },
        startAt,
        binding.botUserId ? [binding.botUserId] : [],
        variant,
        ratings,
        binding.teamId,
      );
    } catch {
      clear();
      throw new RequestError(503, "unavailable");
    }
    const current = this.read();
    if (current?.round?.id === id) {
      current.round.status = "open";
      this.save(current);
      await this.arm(current);
    }
    return {
      startAt: new Date(startAt).toISOString(),
      spectatorCapability: spectator,
    };
  }
  async alarm() {
    const binding = this.read();
    if (!binding) return;
    const now = Date.now();
    if (now >= binding.expiresAt) {
      await this.expire();
      return;
    }
    if (binding.round && now >= binding.round.endsAt) {
      // Wipes the raw spectator capability with the round.
      delete binding.round;
      this.save(binding);
    }
    await this.arm(binding);
  }
}
