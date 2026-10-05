import type { WheelVariant } from "../shared/variant";
import {
  validRatingSettings,
  type RatingSettings,
  type RatingRound,
} from "../shared/ratings";
import {
  queueChannelNotice,
  queueResult,
  REMINDER_LEAD_MS,
  REMINDER_MIN_LEAD_MS,
  type SlackState,
} from "./slack/state";
import {
  createSession,
  startDraw,
  advanceDraw,
} from "../src/domain/drawEngine";
import { getCapabilities } from "../src/domain/capabilities";
import { validateParticipants } from "../src/utils/participants";
import type { BeerWheelSession, ClientRole } from "../src/domain/models";
import type { ScheduledDraw, PublicBeerWheelSession } from "../shared/protocol";

import {
  DEFAULT_SESSION_TTL_MS,
  SCHEDULE_RETENTION_MS,
  MAX_SCHEDULE_AHEAD_MS,
} from "../shared/retention";
export const TTL_MS = DEFAULT_SESSION_TTL_MS;
// Long enough for every screen to show a synchronized 3-2-1 before the wheels move.
export const START_DELAY_MS = 4000;
/** Channel rounds stop refreshing this long before the final pre-draw check. */
export const CHANNEL_REFRESH_MARGIN_MS = 30000;
export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export interface StoredSession {
  ratingSettings?: RatingSettings;
  ratingRounds?: (RatingRound & {
    electorate: string[];
    identities: Record<string, string>;
  })[];
  ratingGrants?: Record<string, { hash: string; drawId: string }>;
  variant?: WheelVariant;
  session: BeerWheelSession;
  hostHash: string;
  spectatorHash: string;
  createdAt: number;
  expiresAt: number;
  revision: number;
  preferredCount: number;
  mutationWindow: number;
  mutations: number;
  draws: number;
  slack?: SlackState;
  scheduledDraw?: ScheduledDraw;
  scheduleCheckUntil?: number;
}
export function newSession(
  hostHash: string,
  spectatorHash: string,
  now: number,
  variant: WheelVariant = "beer",
): StoredSession {
  return {
    variant,
    session: createSession(crypto.randomUUID()),
    hostHash,
    spectatorHash,
    createdAt: now,
    expiresAt: now + TTL_MS,
    revision: 0,
    preferredCount: 2,
    mutationWindow: now,
    mutations: 0,
    draws: 0,
  };
}
export function publicSession(record: StoredSession): PublicBeerWheelSession {
  const s = record.session;
  return {
    variant: record.variant ?? "beer",
    participants: s.participants.map((p) => ({
      id: p.id,
      name: p.name,
      ...(record.ratingSettings?.enabled && p.rating
        ? { rating: { average: p.rating.average, count: p.rating.count } }
        : {}),
    })),
    winnerCount: s.winnerCount,
    state: s.state,
    winnerIds: [...s.winnerIds],
    ...(s.activeDraw
      ? {
          activeDraw: {
            id: s.activeDraw.id,
            startAt: s.activeDraw.startAt,
            participantIds: [...s.activeDraw.participantIds],
            spins: s.activeDraw.spins.map((p) => ({
              id: p.id,
              wheelIndex: p.wheelIndex,
              winnerId: p.winnerId,
              startAt: p.startAt,
              durationMs: p.durationMs,
              rotations: p.rotations,
              startRotation: p.startRotation,
              targetRotation: p.targetRotation,
              easing: p.easing,
            })),
          },
        }
      : {}),
    ...(record.scheduledDraw
      ? {
          scheduledDraw: {
            startAt: record.scheduledDraw.startAt,
            status: record.scheduledDraw.status,
          },
        }
      : {}),
    expiresAt: new Date(record.expiresAt).toISOString(),
    revision: record.revision,
    ...(record.ratingSettings
      ? {
          ratings: {
            ...record.ratingSettings,
            rounds: (record.ratingRounds ?? []).map((r) => ({
              drawId: r.drawId,
              opensAt: r.opensAt,
              winners: r.winners.map((w) => ({ id: w.id, name: w.name })),
            })),
          },
        }
      : {}),
  };
}
/** Only the durable alarm calls this after its final server-side Slack check. */
export function executeScheduledDraw(
  record: StoredSession,
  now: number,
  ready: boolean,
): void {
  const plan = record.scheduledDraw;
  if (!plan || plan.status !== "refreshing" || now >= record.expiresAt) return;
  record.scheduledDraw = { ...plan, status: "skipped" };
  delete record.scheduleCheckUntil;
  try {
    if (!ready) throw new RequestError(409, "not_ready");
    mutate(
      record,
      "host",
      { type: "startDraw", revision: record.revision },
      now,
    );
  } catch (error) {
    if (!(error instanceof RequestError)) throw error;
    record.revision++;
  }
  if (record.slack?.channelRound && record.session.state !== "countdown")
    queueChannelNotice(
      record,
      ready && !record.session.participants.length ? "empty" : "unreadable",
      now,
    );
}
/**
 * Channel rounds have no host, so the server re-reads reactions on its own and
 * viewers watch the wheel fill. Never close to the final check before the draw.
 */
export function channelRefreshAt(record: StoredSession): number | undefined {
  const slack = record.slack,
    plan = record.scheduledDraw;
  if (
    !slack?.channelRound ||
    !slack.source ||
    slack.importing ||
    plan?.status !== "pending"
  )
    return;
  const at = Math.max(slack.nextImportAt ?? 0, slack.retryImportAt ?? 0);
  return at <
    Date.parse(plan.startAt) - START_DELAY_MS - CHANNEL_REFRESH_MARGIN_MS
    ? at
    : undefined;
}
export function advance(record: StoredSession, now: number): boolean {
  if (now >= record.expiresAt) return false;
  let s = record.session;
  if (
    s.state === "countdown" &&
    s.activeDraw &&
    now >= Date.parse(s.activeDraw.startAt)
  )
    s = { ...s, state: "spinning" };
  if (s.activeDraw) s = advanceDraw(s, s.activeDraw.id, now);
  if (s === record.session) return false;
  record.session = s;
  record.revision++;
  return true;
}
export function nextDeadline(record: StoredSession): number {
  const s = record.session,
    draw = s.activeDraw;
  const times = [record.expiresAt];
  if (record.scheduledDraw?.status === "pending")
    times.push(Date.parse(record.scheduledDraw.startAt) - START_DELAY_MS);
  if (record.scheduledDraw?.status === "refreshing")
    times.push(record.scheduleCheckUntil ?? record.expiresAt);
  const slack = record.slack;
  const refresh = channelRefreshAt(record);
  if (refresh !== undefined) times.push(refresh);
  if (slack?.importing) times.push(slack.importing.until);
  if (slack?.job?.status === "pending") times.push(slack.job.readyAt);
  if (slack?.job?.status === "posting")
    times.push(slack.job.attemptedAt! + 120000);
  const reminder = slack?.reminder;
  if (reminder?.status === "pending") times.push(reminder.readyAt);
  if (reminder?.status === "posting")
    times.push(reminder.attemptedAt! + 120000);
  if (reminder?.status === "failed" && reminder.capability && reminder.retryAt)
    times.push(reminder.retryAt);
  if (draw && s.state === "countdown") times.push(Date.parse(draw.startAt));
  if (draw && ["countdown", "spinning"].includes(s.state))
    times.push(
      ...draw.spins
        .filter((p) => !s.winnerIds.includes(p.winnerId))
        .map((p) => Date.parse(p.startAt) + p.durationMs),
    );
  return Math.min(...times);
}
/** Drops any reminder, and with it the stored raw spectator capability. */
function clearReminder(record: StoredSession) {
  if (record.slack) delete record.slack.reminder;
}
/**
 * `verifiedSpectator` is the command's spectator capability only after the
 * caller has matched its hash to the stored spectator hash; otherwise absent.
 */
export function mutate(
  record: StoredSession,
  role: ClientRole,
  input: unknown,
  now: number,
  verifiedSpectator?: string,
): void {
  if (now >= record.expiresAt) throw new RequestError(404, "unavailable");
  if (role !== "host") throw new RequestError(403, "forbidden");
  if (
    !input ||
    typeof input !== "object" ||
    !("type" in input) ||
    !("revision" in input)
  )
    throw new RequestError(400, "invalid");
  if (input.revision !== record.revision)
    throw new RequestError(409, "conflict");
  const command = input as Record<string, unknown>;
  const allowed: Record<string, string[]> = {
    setRatings: ["settings"],
    setParticipants: ["names"],
    setWinnerCount: ["count"],
    setScheduledDraw: ["startAt", "spectatorCapability"],
    startDraw: [],
    reset: [],
    endSession: [],
    slackManual: [],
    slackRetry: [],
  };
  if (
    typeof command.type !== "string" ||
    !Object.hasOwn(allowed, command.type) ||
    Object.keys(command).some(
      (k) =>
        !["type", "revision", ...allowed[command.type as string]].includes(k),
    )
  )
    throw new RequestError(400, "invalid");
  if (now - record.mutationWindow >= 60000) {
    record.mutationWindow = now;
    record.mutations = 0;
    record.draws = 0;
  }
  if (
    record.mutations >= 60 ||
    (command.type === "startDraw" && record.draws >= 6)
  )
    throw new RequestError(429, "rate_limited");
  if (
    command.type !== "endSession" &&
    record.slack?.importing &&
    record.slack.importing.until > now
  )
    throw new RequestError(409, "slack_busy");
  if (
    ["reset", "startDraw"].includes(String(command.type)) &&
    record.slack?.job &&
    ["pending", "posting"].includes(record.slack.job.status)
  )
    throw new RequestError(409, "slack_posting");
  if (
    record.scheduledDraw?.status === "refreshing" &&
    command.type !== "endSession"
  )
    throw new RequestError(409, "not_ready");
  const caps = getCapabilities(role, record.session);
  const require = (value: boolean) => {
    if (!value) throw new RequestError(409, "not_ready");
  };
  switch (command.type) {
    case "setRatings":
      require(caps.canManageParticipants);
      if (!validRatingSettings(command.settings))
        throw new RequestError(400, "invalid");
      if (!record.slack?.teamId)
        throw new RequestError(403, "ratings_slack_required");
      record.ratingSettings = { ...command.settings };
      break;
    case "setParticipants": {
      require(caps.canManageParticipants);
      if (
        !Array.isArray(command.names) ||
        command.names.length > 100 ||
        command.names.some((n) => typeof n !== "string" || n.length > 128)
      )
        throw new RequestError(400, "invalid");
      const old = new Map(
        record.session.participants.map((p) => [
          p.name.toLocaleLowerCase("nl"),
          p.id,
        ]),
      );
      try {
        const participants = validateParticipants(
          command.names.map((raw: string) => {
            const name = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
            if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error();
            return {
              id: old.get(name.toLocaleLowerCase("nl")) ?? crypto.randomUUID(),
              name,
            };
          }),
        );
        record.session = createSession(
          record.session.id,
          participants,
          record.preferredCount,
        );
      } catch {
        throw new RequestError(400, "invalid_participants");
      }
      break;
    }
    case "setWinnerCount":
      require(caps.canConfigureDraw);
      if (
        typeof command.count !== "number" ||
        !Number.isSafeInteger(command.count) ||
        command.count < 1 ||
        command.count > record.session.participants.length
      )
        throw new RequestError(400, "invalid");
      record.preferredCount = command.count;
      record.session = { ...record.session, winnerCount: command.count };
      break;
    case "setScheduledDraw": {
      require(caps.canManageParticipants);
      const notify = command.spectatorCapability;
      if (command.startAt === null) {
        if (notify !== undefined) throw new RequestError(400, "invalid");
        delete record.scheduledDraw;
        clearReminder(record);
        break;
      }
      if (notify !== undefined) {
        if (typeof notify !== "string" || notify !== verifiedSpectator)
          throw new RequestError(403, "forbidden");
        if (!record.slack?.source) throw new RequestError(409, "slack_link");
      }
      const at =
        typeof command.startAt === "string" ? Date.parse(command.startAt) : NaN;
      if (
        !Number.isFinite(at) ||
        new Date(at).toISOString() !== command.startAt ||
        at < now + START_DELAY_MS ||
        at > now + MAX_SCHEDULE_AHEAD_MS
      )
        throw new RequestError(400, "invalid_schedule");
      const extendedExpiry = at + SCHEDULE_RETENTION_MS;
      if (
        record.slack &&
        extendedExpiry > (record.slack.grantExpiresAt ?? record.expiresAt)
      )
        throw new RequestError(400, "schedule_access_expires");
      record.expiresAt = Math.max(record.expiresAt, extendedExpiry);
      record.scheduledDraw = {
        startAt: command.startAt as string,
        status: "pending",
      };
      clearReminder(record);
      // Too close to the start to be useful: plan the draw without a reminder.
      if (notify !== undefined && at - now >= REMINDER_MIN_LEAD_MS)
        record.slack!.reminder = {
          id: crypto.randomUUID(),
          startAt: command.startAt as string,
          readyAt: Math.max(now, at - REMINDER_LEAD_MS),
          capability: notify as string,
          status: "pending",
          attempts: 0,
        };
      break;
    }
    case "startDraw":
      require(caps.canStartDraw);
      if (
        record.ratingSettings?.enabled &&
        (!record.slack?.source || !record.slack.teamId)
      )
        throw new RequestError(409, "ratings_slack_required");
      if (
        record.ratingSettings?.enabled &&
        (record.ratingRounds?.length ?? 0) >= 100
      )
        throw new RequestError(429, "rate_limited");
      if (
        record.ratingSettings?.enabled &&
        now +
          START_DELAY_MS +
          5250 +
          record.ratingSettings.delayMinutes * 60000 >=
          record.expiresAt
      )
        throw new RequestError(409, "ending");
      if (now + START_DELAY_MS + 5250 >= record.expiresAt)
        throw new RequestError(409, "ending");
      record.session = {
        ...startDraw(record.session, {
          id: crypto.randomUUID(),
          startAt: new Date(now + START_DELAY_MS).toISOString(),
        }),
        state: "countdown",
      };
      if (record.slack) delete record.slack.job;
      queueResult(record);
      if (record.ratingSettings?.enabled) {
        const draw = record.session.activeDraw!;
        const identities = Object.fromEntries(
          Object.entries(record.slack!.mapping).map(([user, id]) => [id, user]),
        );
        const winners = draw.spins
          .filter((s) => identities[s.winnerId])
          .map(
            (s) =>
              record.session.participants.find((p) => p.id === s.winnerId)!,
          )
          .map((p) => ({ id: p.id, name: p.name }));
        if (winners.length)
          (record.ratingRounds ??= []).push({
            drawId: draw.id,
            opensAt: new Date(
              Date.parse(draw.startAt) +
                Math.max(...draw.spins.map((s) => s.durationMs)) +
                record.ratingSettings.delayMinutes * 60000,
            ).toISOString(),
            winners,
            identities,
            electorate: record.session.participants
              .map((p) => identities[p.id])
              .filter((id): id is string => !!id),
          });
      }
      delete record.scheduledDraw;
      clearReminder(record);
      record.draws++;
      break;
    case "reset":
      require(caps.canReset);
      delete record.scheduledDraw;
      clearReminder(record);
      record.session = createSession(
        record.session.id,
        record.session.participants,
        record.preferredCount,
      );
      break;
    case "slackManual":
      require(caps.canManageParticipants);
      if (!record.slack) throw new RequestError(403, "forbidden");
      delete record.slack.source;
      delete record.slack.syncedAt;
      delete record.slack.count;
      clearReminder(record);
      // Keep private identities so a later import replaces these participants.
      // Clearing the source above still disables Slack posting in manual mode.
      break;
    case "slackRetry": {
      const job = record.slack?.job;
      if (!job || job.status !== "failed" || now < (job.retryAt ?? Infinity))
        throw new RequestError(409, "not_ready");
      job.status = "pending";
      job.readyAt = now;
      break;
    }
    case "endSession":
      record.expiresAt = now;
      break;
  }
  record.mutations++;
  record.revision++;
}
