import {
  createSession,
  startDraw,
  advanceDraw,
} from "../src/domain/drawEngine";
import { getCapabilities } from "../src/domain/capabilities";
import { validateParticipants } from "../src/utils/participants";
import type { BeerWheelSession, ClientRole } from "../src/domain/models";
import type { PublicBeerWheelSession } from "../shared/protocol";

export const TTL_MS = 8 * 60 * 60 * 1000;
export const START_DELAY_MS = 2000;
export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export interface StoredSession {
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
}
export function newSession(
  hostHash: string,
  spectatorHash: string,
  now: number,
): StoredSession {
  return {
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
    participants: s.participants.map((p) => ({ id: p.id, name: p.name })),
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
    expiresAt: new Date(record.expiresAt).toISOString(),
    revision: record.revision,
  };
}
export function advance(record: StoredSession, now: number): boolean {
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
  if (draw && s.state === "countdown") times.push(Date.parse(draw.startAt));
  if (draw && ["countdown", "spinning"].includes(s.state))
    times.push(
      ...draw.spins
        .filter((p) => !s.winnerIds.includes(p.winnerId))
        .map((p) => Date.parse(p.startAt) + p.durationMs),
    );
  return Math.min(...times);
}
export function mutate(
  record: StoredSession,
  role: ClientRole,
  input: unknown,
  now: number,
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
    setParticipants: ["names"],
    setWinnerCount: ["count"],
    startDraw: [],
    reset: [],
    endSession: [],
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
  const caps = getCapabilities(role, record.session);
  const require = (value: boolean) => {
    if (!value) throw new RequestError(409, "not_ready");
  };
  switch (command.type) {
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
    case "startDraw":
      require(caps.canStartDraw);
      if (now + START_DELAY_MS + 5250 >= record.expiresAt)
        throw new RequestError(409, "ending");
      record.session = {
        ...startDraw(record.session, {
          id: crypto.randomUUID(),
          startAt: new Date(now + START_DELAY_MS).toISOString(),
        }),
        state: "countdown",
      };
      record.draws++;
      break;
    case "reset":
      require(caps.canReset);
      record.session = createSession(
        record.session.id,
        record.session.participants,
        record.preferredCount,
      );
      break;
    case "endSession":
      record.expiresAt = now;
      break;
  }
  record.mutations++;
  record.revision++;
}
