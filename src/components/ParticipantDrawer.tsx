import { useId, useMemo, useState } from "react";
import { useTheme } from "../Theme";
import type { BeerWheelSession } from "../domain/models";
import { countLabel } from "../domain/presentation";
import { formatChance, winOdds } from "../domain/odds";
import { themeFor } from "../../shared/variant";
/** The names are already on the wheels; the list, with everyone's odds, stays one tap away. */
export function ParticipantDrawer({ session }: { session: BeerWheelSession }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const id = useId();
  const people = session.participants;
  const odds = useMemo(() => winOdds(session), [session]);
  const goals = session.goals;
  return (
    <div
      className="participant-drawer"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {theme.icon} {countLabel(people.length, "deelnemer", "deelnemers")}{" "}
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="participant-drawer-panel" id={id}>
          <h2>De {theme.crew}</h2>
          {odds && (
            <div className="participant-odds-note">
              {goals ? "Kans om een van de raden te winnen" : "Kans om te winnen"}
            </div>
          )}
          <ul className={goals && odds ? "with-goals" : undefined}>
            {people.map((person) => {
              const total = odds?.total.get(person.id);
              return (
                <li key={person.id}>
                  <span className="participant-odds-row">
                    <span>{person.name}</span>
                    {total !== undefined && <strong>{formatChance(total)}</strong>}
                  </span>
                  {goals && odds?.perGoal && (
                    <span className="participant-goal-odds">
                      {goals.map((goal, i) => {
                        const chance = odds.perGoal![i].get(person.id);
                        if (chance === undefined) return null;
                        const goalTheme = themeFor(goal.variant, goal.title);
                        return (
                          <span key={goal.variant} title={goalTheme.name}>
                            {goalTheme.icon} {formatChance(chance)}
                          </span>
                        );
                      })}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
