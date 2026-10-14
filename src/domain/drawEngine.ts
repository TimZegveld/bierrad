import type {
  BeerWheelSession,
  DrawGoal,
  DrawInstruction,
  Participant,
  SpinInstruction,
} from "./models";
import {
  idleRotation,
  landingMargin,
  landingRotation,
  wheelSlices,
} from "./spin";
import { validateParticipants } from "../utils/participants";
import {
  randomFraction,
  selectRiggedWinners,
  type DrawRig,
} from "../utils/random";
import { MAX_GOALS, selectGoalWinners } from "../utils/goalDraw";
import { isWheelVariant, roundTitle } from "../../shared/variant";

export function constrainWinnerCount(
  desired: number,
  participantCount: number,
): number {
  if (!Number.isSafeInteger(desired) || desired < 1)
    throw new Error("Kies minstens één bierhaler.");
  return participantCount ? Math.min(desired, participantCount) : desired;
}
export function createSession(
  id: string,
  participants: readonly Participant[] = [],
  desiredCount = 2,
): BeerWheelSession {
  const roster = validateParticipants(participants);
  return {
    id,
    participants: roster,
    winnerCount: constrainWinnerCount(desiredCount, roster.length),
    state: roster.length ? "ready" : "setup",
    mode: "manual",
    winnerIds: [],
  };
}
/** A pool's people with the given slice sizes instead of their own. */
function pool(
  session: BeerWheelSession,
  ids: readonly string[],
  weights?: readonly number[],
): readonly Participant[] {
  const byId = new Map(session.participants.map((p) => [p.id, p]));
  return ids.map((id, i) => {
    const { weight: _, ...person } = byId.get(id)!;
    const weight = weights?.[i] ?? 1;
    return weight > 1 ? { ...person, weight } : person;
  });
}
/** The people on one wheel; in a Feestrad each wheel shows its own goal's pool. */
export function wheelParticipants(
  session: BeerWheelSession,
  wheelIndex = 0,
): readonly Participant[] {
  const draw = session.activeDraw;
  // The frozen slice sizes, so a replay lands exactly where the draw did.
  const spin = draw?.spins.find((s) => s.wheelIndex === wheelIndex);
  if (spin?.participantIds)
    return pool(session, spin.participantIds, spin.weights);
  const goal = session.goals?.[wheelIndex];
  if (goal) return pool(session, goal.participantIds, goal.weights);
  if (!draw) return session.participants;
  return pool(session, draw.participantIds, draw.weights);
}
/**
 * Turns a round into a Feestrad: one wheel and one winner per goal. Every
 * goal's IDs must be participants and every participant must have joined a goal.
 */
export function withGoals(
  session: BeerWheelSession,
  goals: readonly DrawGoal[],
): BeerWheelSession {
  if (!goals.length || goals.length > MAX_GOALS)
    throw new Error("Een feestronde heeft één tot drie doelen.");
  const known = new Set(session.participants.map((p) => p.id));
  const joined = new Set<string>();
  const frozen = goals.map((goal, i): DrawGoal => {
    const ids = [...goal.participantIds];
    // Each kind of wheel once; only the Koekrad carries a word.
    const title = goal.variant === "cookie" ? roundTitle(goal.title) : undefined;
    if (
      !isWheelVariant(goal.variant) ||
      goals.findIndex((g) => g.variant === goal.variant) !== i ||
      (goal.title !== undefined && !title)
    )
      throw new Error("Ongeldig doel.");
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !known.has(id)) ||
      (goal.weights &&
        (goal.weights.length !== ids.length ||
          goal.weights.some(
            (w) => !Number.isSafeInteger(w) || w < 1 || w > 100,
          )))
    )
      throw new Error("Ongeldige of dubbele deelnemers.");
    ids.forEach((id) => joined.add(id));
    return {
      variant: goal.variant,
      ...(title ? { title } : {}),
      participantIds: ids,
      ...(goal.weights?.some((w) => w > 1)
        ? { weights: [...goal.weights] }
        : {}),
    };
  });
  if (joined.size !== known.size)
    throw new Error("Ongeldige of dubbele deelnemers.");
  return { ...session, goals: frozen, winnerCount: goals.length };
}
/** Empty setup shows a placeholder instead of an unbounded saved preference. */
export function wheelCount(session: BeerWheelSession): number {
  if (session.goals) return session.goals.length;
  return (
    session.activeDraw?.spins.length ??
    (session.participants.length ? session.winnerCount : 1)
  );
}
export function sessionWinners(
  session: BeerWheelSession,
): readonly Participant[] {
  return session.winnerIds.map((id) =>
    session.participants.find((p) => p.id === id)!,
  );
}
/** Whether a draw can pick anyone: a Feestrad needs one goal with people. */
export function drawable(session: BeerWheelSession): boolean {
  if (session.goals)
    return session.goals.some((g) => g.participantIds.length > 0);
  return (
    session.winnerCount >= 1 &&
    session.winnerCount <= session.participants.length
  );
}
/** One wheel's playback, landing on a winner that is already chosen. */
function spinFor(
  session: BeerWheelSession,
  timing: Pick<DrawInstruction, "id" | "startAt">,
  wheelIndex: number,
  winnerId: string,
  participantIds: readonly string[],
  weights?: readonly number[],
): SpinInstruction {
  const slices = wheelSlices(participantIds.length, weights);
  const rotations = 6 + (wheelIndex % 2);
  const index = participantIds.indexOf(winnerId);
  const margin = landingMargin(participantIds.length, slices[index].size);
  const startRotation =
    session.activeDraw?.spins.find((s) => s.wheelIndex === wheelIndex)
      ?.targetRotation ??
    idleRotation(wheelIndex, participantIds.length, weights);
  return {
    id: `${timing.id}:${wheelIndex}`,
    wheelIndex,
    winnerId,
    startAt: timing.startAt,
    durationMs: 6500 + [0, 300, 150, 450, 250][wheelIndex % 5],
    rotations,
    startRotation,
    targetRotation: landingRotation(
      startRotation,
      index,
      participantIds.length,
      rotations,
      // Uniform like a real wheel: sometimes just past a border, sometimes just short.
      margin + randomFraction() * (1 - 2 * margin),
      weights,
    ),
    // Long, slow tail so the last border crossings stay exciting.
    easing: "cubic-bezier(.3,0,0,1)" as const,
  };
}
/** One atomic selection, then one authoritative instruction for every wheel. */
export function startDraw(
  session: BeerWheelSession,
  timing: Pick<DrawInstruction, "id" | "startAt">,
  rig?: DrawRig,
): BeerWheelSession {
  if (
    session.mode !== "manual" ||
    !["ready", "finished"].includes(session.state)
  )
    throw new Error("Het rad is niet klaar.");
  if (!timing.id || !Number.isFinite(Date.parse(timing.startAt)))
    throw new Error("Ongeldige animatietiming.");
  if (session.goals) return startGoalDraw(session, session.goals, timing);
  const winners = selectRiggedWinners(
    session.participants,
    session.winnerCount,
    rig,
  );
  const participantIds = session.participants.map((p) => p.id);
  const weighted = session.participants.some((p) => (p.weight ?? 1) > 1);
  const weights = weighted
    ? session.participants.map((p) => p.weight ?? 1)
    : undefined;
  const spins = winners.map((winner, wheelIndex) =>
    spinFor(session, timing, wheelIndex, winner.id, participantIds, weights),
  );
  return {
    ...session,
    state: "spinning",
    winnerIds: [],
    activeDraw: {
      ...timing,
      participantIds,
      ...(weights ? { weights } : {}),
      spins,
    },
  };
}
/**
 * A Feestrad: one joint selection over every goal, never rigged, so nobody
 * wins twice. Each turning wheel freezes its own pool; a goal nobody is left
 * for gets no spin.
 */
function startGoalDraw(
  session: BeerWheelSession,
  goals: readonly DrawGoal[],
  timing: Pick<DrawInstruction, "id" | "startAt">,
): BeerWheelSession {
  if (!drawable(session)) throw new Error("Het rad is niet klaar.");
  const winners = selectGoalWinners(goals);
  const spins = goals.flatMap((goal, wheelIndex): SpinInstruction[] => {
    const winnerId = winners[wheelIndex];
    if (!winnerId) return [];
    const ids = [...goal.participantIds];
    const weights = goal.weights ? [...goal.weights] : undefined;
    return [
      {
        ...spinFor(session, timing, wheelIndex, winnerId, ids, weights),
        participantIds: ids,
        ...(weights ? { weights } : {}),
      },
    ];
  });
  return {
    ...session,
    state: "spinning",
    winnerIds: [],
    activeDraw: {
      ...timing,
      participantIds: session.participants.map((p) => p.id),
      spins,
    },
  };
}
/** Authority reveals finished wheels and celebrates only after the slowest wheel. */
export function advanceDraw(
  session: BeerWheelSession,
  drawId: string,
  now: number,
): BeerWheelSession {
  const draw = session.activeDraw;
  if (!draw || draw.id !== drawId || session.state !== "spinning")
    return session;
  const winnerIds = draw.spins
    .filter((spin) => now >= Date.parse(draw.startAt) + spin.durationMs)
    .map((spin) => spin.winnerId);
  if (winnerIds.length === session.winnerIds.length) return session;
  return {
    ...session,
    winnerIds,
    state: winnerIds.length === draw.spins.length ? "finished" : "spinning",
  };
}
export function resetSession(session: BeerWheelSession): BeerWheelSession {
  const fresh = createSession(
    session.id,
    session.participants,
    session.winnerCount,
  );
  return session.goals ? withGoals(fresh, session.goals) : fresh;
}
