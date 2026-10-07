import type { BeerWheelSession, DrawInstruction, Participant } from "./models";
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
export function wheelParticipants(
  session: BeerWheelSession,
): readonly Participant[] {
  const draw = session.activeDraw;
  if (!draw) return session.participants;
  const byId = new Map(session.participants.map((p) => [p.id, p]));
  // The frozen slice sizes, so a replay lands exactly where the draw did.
  return draw.participantIds.map((id, i) => {
    const { weight: _, ...person } = byId.get(id)!;
    const weight = draw.weights?.[i] ?? 1;
    return weight > 1 ? { ...person, weight } : person;
  });
}
/** Empty setup shows a placeholder instead of an unbounded saved preference. */
export function wheelCount(session: BeerWheelSession): number {
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
  const slices = wheelSlices(participantIds.length, weights);
  const spins = winners.map((winner, wheelIndex) => {
    const rotations = 6 + (wheelIndex % 2);
    const index = participantIds.indexOf(winner.id);
    const margin = landingMargin(participantIds.length, slices[index].size);
    const startRotation =
      session.activeDraw?.spins[wheelIndex]?.targetRotation ??
      idleRotation(wheelIndex, participantIds.length, weights);
    return {
      id: `${timing.id}:${wheelIndex}`,
      wheelIndex,
      winnerId: winner.id,
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
  });
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
  return createSession(session.id, session.participants, session.winnerCount);
}
