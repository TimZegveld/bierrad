import { useState } from "react";
import type { Participant } from "../types";
import { addParticipant, removeParticipant } from "../utils/participants";
import { colors } from "./BeerWheel";
export function ParticipantManager({
  people,
  locked,
  onChange,
  onRestore,
}: {
  people: Participant[];
  locked: boolean;
  onChange: (p: Participant[]) => void;
  onRestore: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  return (
    <aside className="participant-card">
      <div className="card-heading">
        <div>
          <span className="eyebrow">DE VRIJDAGPLOEG</span>
          <h2>Wie doet er mee?</h2>
        </div>
        <span className="count">{people.length}</span>
      </div>
      <div className="source-tabs">
        <span>✎ &nbsp; Handmatig</span>
        <button disabled title="Binnenkort via een beveiligde backend">
          Slack 🍻 <small>Binnenkort</small>
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            onChange(addParticipant(people, name));
            setName("");
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <label htmlFor="participant">Naam van je collega</label>
        <div className="name-input">
          <input
            id="participant"
            value={name}
            maxLength={32}
            disabled={locked}
            onChange={(e) => setName(e.target.value)}
            placeholder="Bijv. Robin"
            autoComplete="off"
            aria-describedby={error ? "name-error" : undefined}
          />
          <button disabled={locked} aria-label="Deelnemer toevoegen">
            +
          </button>
        </div>
      </form>
      {error && (
        <p className="error" id="name-error" role="alert">
          {error}
        </p>
      )}
      <ul className="people-list">
        {people.map((p, i) => (
          <li key={p.id}>
            <span
              className="avatar"
              style={{ background: colors[i % colors.length] }}
            >
              {p.name.slice(0, 1).toUpperCase()}
            </span>
            <span>{p.name}</span>
            <button
              aria-label={`${p.name} verwijderen`}
              disabled={locked}
              onClick={() => onChange(removeParticipant(people, p.id))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {!people.length && (
        <p className="empty-list">
          Iedereen een plekje op het rad.
          <br />
          Voeg minstens twee collega's toe.
        </p>
      )}
      <div className="list-actions">
        <button
          disabled={locked || !people.length}
          onClick={() => setConfirm(true)}
        >
          Alles wissen
        </button>
        <button disabled={locked} onClick={onRestore}>
          ↶ Vorige lijst
        </button>
      </div>
      {confirm && (
        <div className="confirm">
          <p>Alle deelnemers van het rad halen?</p>
          <button
            disabled={locked}
            onClick={() => {
              onChange([]);
              setConfirm(false);
            }}
          >
            Ja, wis de lijst
          </button>
          <button onClick={() => setConfirm(false)}>Annuleren</button>
        </div>
      )}
      <p className="storage-note">
        ▣ &nbsp; Je lijst wordt op dit apparaat bewaard.
      </p>
    </aside>
  );
}
