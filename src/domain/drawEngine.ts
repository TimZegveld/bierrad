import type { BeerWheelSession, DrawInstruction, Participant } from "./models";
import { landingRotation } from "./spin";
import { validateParticipants } from "../utils/participants";
import { selectUniqueWinners } from "../utils/random";

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
  if (!session.activeDraw) return session.participants;
  const byId = new Map(session.participants.map((p) => [p.id, p]));
  return session.activeDraw.participantIds.map((id) => byId.get(id)!);
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
): BeerWheelSession {
  if (
    session.mode !== "manual" ||
    !["ready", "finished"].includes(session.state)
  )
    throw new Error("Het rad is niet klaar.");
  if (!timing.id || !Number.isFinite(Date.parse(timing.startAt)))
    throw new Error("Ongeldige animatietiming.");
  const winners = selectUniqueWinners(
    session.participants,
    session.winnerCount,
  );
  const participantIds = session.participants.map((p) => p.id);
  const spins = winners.map((winner, wheelIndex) => {
    const rotations = 6 + (wheelIndex % 2);
    const startRotation =
      session.activeDraw?.spins[wheelIndex]?.targetRotation ?? 0;
    return {
      id: `${timing.id}:${wheelIndex}`,
      wheelIndex,
      winnerId: winner.id,
      startAt: timing.startAt,
      durationMs: 4800 + [0, 300, 150, 450, 250][wheelIndex % 5],
      rotations,
      startRotation,
      targetRotation: landingRotation(
        startRotation,
        participantIds.indexOf(winner.id),
        participantIds.length,
        rotations,
      ),
      easing: "cubic-bezier(.35,0,.12,1)" as const,
    };
  });
  return {
    ...session,
    state: "spinning",
    winnerIds: [],
    activeDraw: { ...timing, participantIds, spins },
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
