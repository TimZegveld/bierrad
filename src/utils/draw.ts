import type { DrawState, Participant } from "../types";
export interface Draw {
  state: DrawState;
  original: Participant[];
  wheel: Participant[];
  winners: Participant[];
  pending?: Participant;
}
export function createDraw(participants: Participant[]): Draw {
  return {
    state: participants.length >= 2 ? "ready" : "setup",
    original: [...participants],
    wheel: [...participants],
    winners: [],
  };
}
export function startSpin(draw: Draw, winner: Participant): Draw {
  if (!["ready", "first-winner"].includes(draw.state))
    throw new Error("Het rad is niet klaar.");
  const wheel = draw.original.filter(
    (p) => !draw.winners.some((w) => w.id === p.id),
  );
  if (!wheel.some((p) => p.id === winner.id))
    throw new Error("Ongeldige winnaar.");
  return {
    ...draw,
    wheel,
    pending: winner,
    state: draw.winners.length ? "spinning-second" : "spinning-first",
  };
}
export function finishSpin(draw: Draw): Draw {
  if (!draw.pending) return draw;
  return {
    ...draw,
    winners: [...draw.winners, draw.pending],
    pending: undefined,
    state: draw.state === "spinning-first" ? "first-winner" : "finished",
  };
}
export const resetDraw = (draw: Draw) => createDraw(draw.original);
