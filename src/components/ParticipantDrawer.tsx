import { useId, useState } from "react";
import { useTheme } from "../Theme";
import type { Participant } from "../domain/models";
import { countLabel } from "../domain/presentation";
import { RatingStars } from "./RatingStars";
/** The names are already on the wheels; the list stays one tap away. */
export function ParticipantDrawer({
  people,
}: {
  people: readonly Participant[];
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const id = useId();
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
          <ul>
            {people.map((person) => (
              <li key={person.id}>
                <span>{person.name}</span>
                {person.rating && (
                  <RatingStars rating={person.rating} compact />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
