import { useState } from "react";
import type { Participant } from "../types";
import { createDraw, startSpin, finishSpin, resetDraw } from "../utils/draw";
import { pickWinner } from "../utils/random";
export function useBeerWheel() {
  const [draw, setDraw] = useState(() => createDraw([]));
  return {
    draw,
    setParticipants: (people: Participant[]) => setDraw(createDraw(people)),
    spin: () =>
      setDraw((d) =>
        ["ready", "first-winner"].includes(d.state)
          ? startSpin(
              d,
              pickWinner(
                d.original,
                d.winners.map((w) => w.id),
              ),
            )
          : d,
      ),
    finish: () => setDraw(finishSpin),
    reset: () => setDraw(resetDraw),
  };
}
