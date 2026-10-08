import { DurableObject } from "cloudflare:workers";
import {
  CHANNEL_IDLE_TTL_MS,
  channelApp,
  channelApps,
  DEFAULT_BEER_WINNERS,
  DEFAULT_ROUND_MINUTES,
  MAX_ROUNDS_PER_DAY,
  roundCopy,
  roundStartAt,
  validRoundMinutes,
  validWinnerCount,
  type ChannelApp,
  type ChannelCommandResult,
  type ChannelStatus,
  type ChannelVariant,
} from "../../shared/channel";
import { roundTitle, themes } from "../../shared/variant";
import {
  DEFAULT_REVIEW_SETTINGS,
  MAX_MEMBERS,
  MEMBER_TTL_MS,
  validReviewMinutes,
  type ReviewSettings,
} from "../../shared/reviews";
import {
  MAX_SCHEDULE_AHEAD_MS,
  SCHEDULE_RETENTION_MS,
} from "../../shared/retention";
import {
  equalHash,
  hashSecret,
  pseudonym,
  randomHex,
  randomWords,
  wordLocator,
} from "../auth";
import { frontend, json } from "../http";
import { RequestError } from "../session";
import { SlackApiClient } from "../slack/api";
import {
  loginConfigured,
  slackEnvironment,
  type SlackSecrets,
} from "../slack/access";
import { postMessage, REMINDER_LEAD_MS } from "../slack/state";
import { beerCallBody, boundBody, callBody } from "./messages";
import { slashHelp, validChannelName } from "./slash";
import { cleanIntro, MIN_BEER_LEAD_MS } from "./beer";

const DAY_MS = 24 * 60 * 60 * 1000;
/** A round (and so its result) can be watched until this long after its start. */
export const ROUND_WATCH_MS = 30 * 60 * 1000;
/** A round blocks the next until its draw is over, or at most this long after its start. */
export const ROUND_BLOCK_MS = 3 * 60 * 1000;
function blocking(round: Round, now: number, settledId?: string) {
  return round.id !== settledId && now < round.startAt + ROUND_BLOCK_MS;
}
/** Bierrad reviews take longer than coffee: fetching beer takes a while. */
const DEFAULT_BEER_REVIEW_SETTINGS: ReviewSettings = {
  enabled: true,
  minutes: 30,
};
/** A Bierrad round asked for with `/bierrad`; others wait a number of minutes. */
export interface SlashRound {
  variant: ChannelVariant;
  minutes?: number;
  channelName?: string;
  title?: string;
  startAt?: number;
  winners?: number;
  intro?: string;
}

interface Round {
  id: string;
  /** Absent on rounds from before water; those are coffee. */
  variant?: ChannelVariant;
  /** Koekrad only: the validated word from `/koekrad <titel>`; display only. */
  title?: string;
  status: "posting" | "open";
  startAt: number;
  endsAt: number;
  /**
   * Raw spectator capability of the round, also posted in the channel. Kept
   * server-side only until the round can no longer be watched.
   */
  spectatorCapability: string;
  reviews?: boolean;
}
/** A personal link from Sign in with Slack: no identity, only a pseudonym. */
interface Member {
  hash: string;
  pseudonym: string;
  expiresAt: number;
}
interface Binding {
  /** The Slack app this channel is bound with; absent on Koffierad bindings. */
  app?: ChannelApp;
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
  /** Last channel name Slack sent with a signed slash command; display only. */
  channelName?: string;
  /** What the latest round fetched, so an idle screen keeps its theme. */
  lastVariant?: ChannelVariant;
  defaultMinutes: number;
  /** Bierrad only: winners per round unless `/bierrad` names a number. */
  defaultWinners?: number;
  createdAt: number;
  /** Idle expiry, pushed back by binding and by every round. */
  expiresAt: number;
  window: number;
  rounds: number;
  round?: Round;
  /** Default for new rounds; absent means off. */
  reviews?: ReviewSettings;
  /** Random HMAC key for member pseudonyms; replaced on every bind. */
  memberKey?: string;
  members?: Member[];
  /** Sessions of rounds that may still hold a review; locators grant nothing. */
  ballots?: { locator: string; until: number }[];
  /** Personal logins started per minute, so one channel cannot drain Slack quota. */
  loginWindow?: number;
  logins?: number;
}
/** Personal logins a channel may start per minute. */
const MAX_LOGINS_PER_MINUTE = 30;
export interface BindInput {
  app: ChannelApp;
  locator: string;
  channelId: string;
  teamId: string;
  botUserId?: string;
  adminHash: string;
  requestHash: string;
  requestCapability: string;
}
/**
 * One Durable Object per channel and app. The name is derived from both so
 * slash commands find it; like every locator it grants nothing by itself.
 * Koffierad bindings keep their original names.
 */
export async function channelLocator(
  channelId: string,
  app: ChannelApp = "coffee",
): Promise<string> {
  return (
    await hashSecret(
      `${app === "beer" ? "bierrad" : "koffierad"}-channel:${channelId}`,
    )
  ).slice(0, 32);
}
/**
 * Word links carry no locator, so each gets a pointer object named after it
 * that only knows which channel to ask; the channel checks the hash.
 */
export async function channelViewerLocator(words: string): Promise<string> {
  return (await hashSecret(`koffierad-viewer:${words}`)).slice(0, 32);
}
/**
 * Ephemeral replies for a refused slash command. A busy channel names the
 * round that is running, which may be of another kind.
 */
function roundError(
  code: string,
  requested: ChannelVariant,
  running: ChannelVariant,
  runningTitle?: string,
): string | undefined {
  const icon = themes[requested].icon;
  const { name, bot } = channelApps[channelApp(requested)];
  switch (code) {
    case "round_active":
      return `${themes[running].icon} Er loopt al een ${roundCopy(running, runningTitle).round} in dit kanaal. Klik op ${themes[running].icon} onder de oproep om mee te doen.`;
    case "round_limit":
      return `${icon} Vandaag zijn er al genoeg rondes gestart in dit kanaal. Morgen weer!`;
    case "slack_post_failed":
      return `${icon} Het ${name} kon niet in dit kanaal posten. Nodig de ${name}-bot uit met /invite ${bot} en probeer opnieuw.`;
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
      Math.min(
        binding.expiresAt,
        binding.round?.endsAt ?? Infinity,
        ...(binding.members ?? []).map((m) => m.expiresAt),
        ...(binding.ballots ?? []).map((b) => b.until),
      ),
    );
  }
  /** Each binding speaks only through its own app. */
  private slack(app: ChannelApp = this.read()?.app ?? "coffee") {
    return slackEnvironment(this.env, app);
  }
  /** Rebinding replaces both links (the old ones stop working) but keeps the daily count. */
  async bind(input: BindInput, requestLink: string): Promise<void> {
    const viewer = randomWords();
    const viewerHash = await hashSecret(viewer);
    const env = this.slack(input.app);
    if (!loginConfigured(env)) throw new RequestError(503, "unavailable");
    const existing = this.read();
    if (existing && (existing.app ?? "coffee") !== input.app)
      throw new RequestError(409, "unavailable");
    const posted = await postMessage(
      new SlackApiClient(env.SLACK_BOT_TOKEN!),
      input.channelId,
      boundBody(input.channelId, requestLink, input.app),
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
      ...(input.app === "beer" ? { app: "beer" as const } : {}),
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
      ...(previous?.reviews ? { reviews: previous.reviews } : {}),
      defaultMinutes: previous?.defaultMinutes ?? DEFAULT_ROUND_MINUTES,
      ...(input.app === "beer"
        ? { defaultWinners: previous?.defaultWinners ?? DEFAULT_BEER_WINNERS }
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
    if (stored?.viewerCapability) await this.dropViewer(stored.viewerCapability);
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
          .exec<{ channel: string }>("SELECT channel FROM pointer WHERE singleton = 1")
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
      const { round, channelName, variant, app } = this.status(
        current,
        "requester",
        Date.now(),
        settled,
      );
      return json({
        type: "view",
        ...(app ? { app } : {}),
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
    const beer = binding.app === "beer";
    const fallback: ChannelVariant = beer ? "beer" : "coffee";
    return {
      role,
      ...(beer
        ? {
            app: "beer" as const,
            defaultWinners: binding.defaultWinners ?? DEFAULT_BEER_WINNERS,
          }
        : {}),
      variant: (shown ? round.variant : binding.lastVariant) ?? fallback,
      defaultMinutes: binding.defaultMinutes,
      ...(shown
        ? {
            round: {
              variant: round.variant ?? fallback,
              startAt: new Date(round.startAt).toISOString(),
              spectatorCapability: round.spectatorCapability,
              // A settled round stays visible (its result) but no longer blocks.
              active: blocking(round, now, settledId),
              ...(round.reviews ? { reviews: true } : {}),
              ...(round.title ? { title: round.title } : {}),
            },
          }
        : {}),
      roundsLeft: Math.max(0, MAX_ROUNDS_PER_DAY - used),
      expiresAt: new Date(binding.expiresAt).toISOString(),
      ...(binding.viewerCapability
        ? { viewerCapability: binding.viewerCapability }
        : {}),
      ...(binding.channelName ? { channelName: binding.channelName } : {}),
      reviews: this.reviewSettings(binding),
    };
  }
  private reviewSettings(binding: Binding): ReviewSettings {
    return (
      binding.reviews ??
      (binding.app === "beer"
        ? DEFAULT_BEER_REVIEW_SETTINGS
        : DEFAULT_REVIEW_SETTINGS)
    );
  }
  private async authenticate(
    secret: string,
  ): Promise<{ role: ChannelStatus["role"]; member?: Member }> {
    const hash = await hashSecret(secret);
    const binding = this.read();
    if (!binding) throw new RequestError(404, "unavailable");
    const now = Date.now();
    if (now >= binding.expiresAt) {
      await this.expire();
      throw new RequestError(404, "unavailable");
    }
    if (equalHash(hash, binding.adminHash)) return { role: "admin" };
    if (equalHash(hash, binding.requestHash)) return { role: "requester" };
    const member = binding.members?.find(
      (m) => now < m.expiresAt && equalHash(hash, m.hash),
    );
    if (member) return { role: "member", member };
    throw new RequestError(404, "unavailable");
  }
  /** Rounds whose review may still be open, newest first. */
  private ballotSessions(binding: Binding, now: number) {
    return (binding.ballots ?? [])
      .filter((b) => now < b.until)
      .reverse()
      .map((b) => this.env.SESSIONS.getByName(b.locator));
  }
  /** About this member only: joined the current round, and an open ballot. */
  private async memberStatus(
    binding: Binding,
    member: Member,
  ): Promise<NonNullable<ChannelStatus["member"]>> {
    const result: NonNullable<ChannelStatus["member"]> = {};
    for (const session of this.ballotSessions(binding, Date.now())) {
      try {
        const round = await session.memberRound(member.pseudonym);
        if (result.participating === undefined && round.participating !== undefined)
          result.participating = round.participating;
        if (!result.ballot && round.ballot) result.ballot = round.ballot;
      } catch {
        // A gone session holds nothing for anyone.
      }
    }
    return result;
  }
  /**
   * Any channel link may start a personal Sign in with Slack; it proves the
   * person already holds the channel link. Bounded per channel per minute.
   * Resolves the binding's app, whose login is used, or null.
   */
  async memberLoginAllowed(secret: string): Promise<ChannelApp | null> {
    try {
      await this.authenticate(secret);
    } catch {
      return null;
    }
    const binding = this.read();
    if (!binding) return null;
    const now = Date.now();
    if (now - (binding.loginWindow ?? 0) >= 60000) {
      binding.loginWindow = now;
      binding.logins = 0;
    }
    if ((binding.logins ?? 0) >= MAX_LOGINS_PER_MINUTE) return null;
    binding.logins = (binding.logins ?? 0) + 1;
    this.save(binding);
    return binding.app ?? "coffee";
  }
  /**
   * After Sign in with Slack: a new personal link for a full member of the
   * bot's workspace. Only a pseudonym is kept; a new login replaces the old link.
   */
  async addMember(
    userId: string,
    teamId: string,
    app: ChannelApp = "coffee",
  ): Promise<string> {
    const secret = randomHex();
    const hash = await hashSecret(secret);
    let binding = this.read();
    // The login must have used this binding's own app.
    if (
      !binding ||
      Date.now() >= binding.expiresAt ||
      binding.teamId !== teamId ||
      (binding.app ?? "coffee") !== app
    )
      throw new RequestError(404, "unavailable");
    if (!binding.memberKey) {
      binding.memberKey = randomHex();
      this.save(binding);
    }
    const name = await pseudonym(binding.memberKey, userId);
    binding = this.read();
    if (!binding?.memberKey || Date.now() >= binding.expiresAt)
      throw new RequestError(404, "unavailable");
    const now = Date.now();
    const members = (binding.members ?? []).filter(
      (m) => now < m.expiresAt && m.pseudonym !== name,
    );
    // Full: the login closest to expiry makes way.
    members.sort((a, b) => a.expiresAt - b.expiresAt);
    while (members.length >= MAX_MEMBERS) members.shift();
    members.push({ hash, pseudonym: name, expiresAt: now + MEMBER_TTL_MS });
    binding.members = members;
    this.save(binding);
    await this.arm(binding);
    return `${binding.locator}.${secret}`;
  }
  /** Link holders: status, reviews and (admin only) management; never round requests. */
  async access(secret: string, command: unknown): Promise<Response> {
    try {
      // Generated before authorization so no await separates read and write below.
      const rotated = randomHex(),
        viewer = randomWords();
      const [rotatedHash, viewerHash] = await Promise.all([
        hashSecret(rotated),
        hashSecret(viewer),
      ]);
      const { role, member } = await this.authenticate(secret);
      const settled = await this.settledRoundId();
      const reply = async () => {
        const binding = this.read();
        if (!binding) throw new RequestError(404, "unavailable");
        const status = this.status(binding, role, Date.now(), settled);
        if (member) status.member = await this.memberStatus(binding, member);
        return json({ type: "status", status } satisfies ChannelCommandResult);
      };
      if (command === null) return await reply();
      // No round requests: rounds start only from a signed slash command.
      const allowed: Record<string, string[]> = {
        setDefaultMinutes: ["minutes"],
        setDefaultWinners: ["winners"],
        setReviews: ["enabled", "minutes"],
        review: ["drawId", "scores", "texts"],
        logout: [],
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
      if (input.type === "review" || input.type === "logout") {
        // Only a personal link speaks for one person.
        if (!member) throw new RequestError(403, "forbidden");
        if (input.type === "logout") {
          const binding = this.read();
          if (binding?.members) {
            binding.members = binding.members.filter(
              (m) => m.hash !== member.hash,
            );
            this.save(binding);
          }
          return json({ type: "loggedOut" } satisfies ChannelCommandResult);
        }
        const binding = this.read();
        if (!binding) throw new RequestError(404, "unavailable");
        let outcome: { code?: string; status?: number } = {
          status: 409,
          code: "review_closed",
        };
        for (const session of this.ballotSessions(binding, Date.now())) {
          outcome = await session.submitRoundReview(
            member.pseudonym,
            input.drawId,
            { scores: input.scores, texts: input.texts },
          );
          // Another round's session does not know this draw; try the next.
          if (outcome.code !== "review_closed") break;
        }
        if (outcome.code)
          throw new RequestError(outcome.status ?? 400, outcome.code);
      } else {
        if (role !== "admin") throw new RequestError(403, "forbidden");
        const binding = this.read();
        if (!binding || Date.now() >= binding.expiresAt)
          throw new RequestError(404, "unavailable");
        if (input.type === "unbind") {
          await this.expire();
          return json({ type: "unbound" } satisfies ChannelCommandResult);
        }
        if (input.type === "setDefaultMinutes") {
          if (!validRoundMinutes(input.minutes))
            throw new RequestError(400, "invalid");
          binding.defaultMinutes = input.minutes;
          this.save(binding);
        } else if (input.type === "setDefaultWinners") {
          // Only Bierrad rounds draw more than one winner.
          if (binding.app !== "beer" || !validWinnerCount(input.winners))
            throw new RequestError(400, "invalid");
          binding.defaultWinners = input.winners;
          this.save(binding);
        } else if (input.type === "setReviews") {
          if (
            typeof input.enabled !== "boolean" ||
            !validReviewMinutes(input.minutes)
          )
            throw new RequestError(400, "invalid");
          binding.reviews = { enabled: input.enabled, minutes: input.minutes };
          this.save(binding);
        } else {
          // A new channel link also replaces the word link to watch along,
          // and ends every personal link made from the old one.
          const previousViewer = binding.viewerCapability;
          binding.requestHash = rotatedHash;
          binding.requestCapability = `${binding.locator}.${rotated}`;
          binding.viewerHash = viewerHash;
          binding.viewerCapability = viewer;
          delete binding.members;
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
      return await reply();
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
  async slash(request: SlashRound): Promise<string | null> {
    const { variant, channelName } = request;
    const app = frontend(this.env);
    const binding = this.read();
    const icon = themes[variant].icon;
    const own = channelApps[channelApp(variant)];
    // A binding only starts rounds of its own app.
    if (
      !binding ||
      Date.now() >= binding.expiresAt ||
      (binding.app ?? "coffee") !== channelApp(variant)
    )
      return `${icon} Dit kanaal heeft nog geen ${own.name}.${app ? ` Koppel het via ${app.href}#/${own.route}-koppelen` : ""}`;
    // Keeps the shown name current when the channel is renamed.
    const name = validChannelName(channelName);
    if (name && name !== binding.channelName) {
      binding.channelName = name;
      this.save(binding);
    }
    const chosen = request.minutes ?? binding.defaultMinutes;
    if (variant !== "beer" && !validRoundMinutes(chosen))
      return slashHelp(variant);
    try {
      await this.startRound(chosen, request);
      return null;
    } catch (error) {
      const running = this.read()?.round;
      return (
        (error instanceof RequestError &&
          roundError(
            error.code,
            variant,
            running?.variant ?? "coffee",
            running?.title,
          )) ||
        `${icon} Het ${own.name} is nu niet bereikbaar. Probeer het zo opnieuw.`
      );
    }
  }
  /**
   * Claims the round before any Slack call, posts the call, adds the first ☕,
   * 💧, 🍪 or 🍻 and hands the draw to a fresh spectator-only LiveSession.
   */
  private async startRound(
    minutes: number,
    request: SlashRound,
  ): Promise<{ startAt: string; spectatorCapability: string }> {
    const { variant } = request;
    const reaction = themes[variant].reaction;
    // Validated again here: only a Koekrad round carries a word, and only a
    // Bierrad round its own time, winners and text.
    const title = variant === "cookie" ? roundTitle(request.title) : undefined;
    const beer = variant === "beer";
    const intro = beer ? cleanIntro(request.intro) : undefined;
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
    if (
      !binding ||
      now >= binding.expiresAt ||
      (binding.app ?? "coffee") !== channelApp(variant)
    )
      throw new RequestError(404, "unavailable");
    if (!loginConfigured(env) || !app)
      throw new RequestError(503, "unavailable");
    const winners = beer
      ? (request.winners ?? binding.defaultWinners ?? DEFAULT_BEER_WINNERS)
      : 1;
    if (!validWinnerCount(winners)) throw new RequestError(400, "invalid");
    if (
      beer &&
      (typeof request.startAt !== "number" ||
        !Number.isSafeInteger(request.startAt) ||
        // The slash command checked a minute; Slack may have taken a few seconds.
        request.startAt < now + MIN_BEER_LEAD_MS / 2 ||
        request.startAt > now + MAX_SCHEDULE_AHEAD_MS)
    )
      throw new RequestError(400, "invalid");
    const settings = this.reviewSettings(binding);
    // Reviews need the fixed channel page to log in on.
    const reviewed = settings.enabled && !!binding.requestCapability;
    // A round blocks the next until its draw is over; its result stays watchable.
    if (
      binding.round &&
      now < binding.round.endsAt &&
      blocking(binding.round, now, settled)
    )
      throw new RequestError(409, "round_active");
    if (now - binding.window >= DAY_MS) {
      binding.window = now;
      binding.rounds = 0;
    }
    if (binding.rounds >= MAX_ROUNDS_PER_DAY)
      throw new RequestError(429, "round_limit");
    const startAt = beer ? request.startAt! : roundStartAt(now, minutes);
    const id = crypto.randomUUID();
    binding.round = {
      id,
      variant,
      ...(title ? { title } : {}),
      status: "posting",
      startAt,
      endsAt: startAt + ROUND_WATCH_MS,
      spectatorCapability: spectator,
      ...(reviewed ? { reviews: true } : {}),
    };
    if (reviewed) {
      binding.memberKey ??= randomHex();
      binding.ballots = [
        ...(binding.ballots ?? []).filter((b) => now < b.until),
        { locator: sessionLocator, until: startAt + SCHEDULE_RETENTION_MS },
      ].slice(-5);
    }
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
    const route = channelApps[binding.app ?? "coffee"].route;
    const channelPage = binding.requestCapability
      ? `${app.href}#/${route}/${binding.requestCapability}`
      : undefined;
    const viewLink = binding.viewerCapability
      ? `${app.href}#/${route}/${binding.viewerCapability}`
      : undefined;
    // With reviews: the fixed channel page, to log in or just watch.
    // Otherwise the view-only word link follows every round; older
    // bindings fall back to the channel page, or else link per round.
    const link =
      reviewed && channelPage
        ? channelPage
        : (viewLink ?? channelPage ?? `${app.href}#/live/${spectator}`);
    const posted = await postMessage(
      api,
      binding.channelId,
      beer
        ? beerCallBody(binding.channelId, link, startAt, winners, now, intro)
        : callBody(
            binding.channelId,
            link,
            startAt,
            variant,
            reviewed ? "Open de ronde" : undefined,
            title,
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
        reviewed && channelPage && binding.memberKey
          ? {
              minutes: settings.minutes,
              key: binding.memberKey,
              link: channelPage,
            }
          : undefined,
        title,
        beer
          ? {
              winners,
              ...(intro ? { intro } : {}),
              // Two minutes ahead, the thread gets the links to log in or
              // watch; a round that starts sooner has its call fresh in view.
              ...(startAt - now > REMINDER_LEAD_MS + 60000
                ? {
                    reminder: {
                      readyAt: startAt - REMINDER_LEAD_MS,
                      view: viewLink ?? link,
                      ...(reviewed && channelPage ? { login: channelPage } : {}),
                    },
                  }
                : {}),
            }
          : undefined,
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
    const members = binding.members?.filter((m) => now < m.expiresAt);
    const ballots = binding.ballots?.filter((b) => now < b.until);
    if (
      members?.length !== binding.members?.length ||
      ballots?.length !== binding.ballots?.length
    ) {
      binding.members = members;
      binding.ballots = ballots;
      this.save(binding);
    }
    await this.arm(binding);
  }
}
