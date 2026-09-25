import type { BeerWheelSession, Participant, SpinInstruction } from "./models";
import { landingRotation } from "./spin";
import { validateParticipants } from "../utils/participants";

export function createSession(
  id: string,
  participants: readonly Participant[] = [],
): BeerWheelSession {
  const roster = validateParticipants(participants);
  return {
    id,
    participants: roster,
    state: roster.length >= 2 ? "ready" : "setup",
    mode: "manual",
    winnerIds: [],
  };
}
export function eligibleParticipants(
  session: BeerWheelSession,
): readonly Participant[] {
  return session.participants.filter((p) => !session.winnerIds.includes(p.id));
}
export function wheelParticipants(
  session: BeerWheelSession,
): readonly Participant[] {
  if (!session.spin) return session.participants;
  return session.spin.participantIds.map((id) =>
    session.participants.find((p) => p.id === id)!,
  );
}
export function sessionWinners(
  session: BeerWheelSession,
): readonly Participant[] {
  return session.winnerIds.map((id) =>
    session.participants.find((p) => p.id === id)!,
  );
}
export function startSpin(
  session: BeerWheelSession,
  winnerId: string,
  timing: Pick<SpinInstruction, "id" | "startAt" | "durationMs">,
): BeerWheelSession {
  if (
    session.mode !== "manual" ||
    !["ready", "first-winner"].includes(session.state)
  )
    throw new Error("Het rad is niet klaar.");
  if (
    !Number.isFinite(Date.parse(timing.startAt)) ||
    !Number.isFinite(timing.durationMs) ||
    timing.durationMs <= 0
  )
    throw new Error("Ongeldige animatietiming.");
  const people = eligibleParticipants(session);
  const index = people.findIndex((p) => p.id === winnerId);
  if (index < 0) throw new Error("Ongeldige winnaar.");
  const round = session.state === "ready" ? 1 : 2;
  const startRotation = session.spin?.targetRotation ?? 0;
  const spin: SpinInstruction = {
    ...timing,
    round,
    winnerId,
    participantIds: people.map((p) => p.id),
    startRotation,
    targetRotation: landingRotation(startRotation, index, people.length),
    easing: "cubic-bezier(.35,0,.12,1)",
  };
  return {
    ...session,
    spin,
    state: round === 1 ? "spinning-first" : "spinning-second",
  };
}
/** Only the authority's clock can reveal a result, never an animation callback. */
export function finishSpin(
  session: BeerWheelSession,
  spinId: string,
  now: number,
): BeerWheelSession {
  const spin = session.spin;
  if (
    !spin ||
    spin.id !== spinId ||
    !["spinning-first", "spinning-second"].includes(session.state) ||
    now < Date.parse(spin.startAt) + spin.durationMs
  )
    return session;
  return {
    ...session,
    winnerIds: [...session.winnerIds, spin.winnerId],
    state: spin.round === 1 ? "first-winner" : "finished",
  };
}
export function resetSession(session: BeerWheelSession): BeerWheelSession {
  return createSession(session.id, session.participants);
}
