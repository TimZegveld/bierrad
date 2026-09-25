import { useEffect } from "react";
import type { Participant } from "../domain/models";

export function SecretPanel({
  people,
  weights,
  forcedIds,
  onWeight,
  onForced,
  onClose,
}: {
  people: readonly Participant[];
  weights: Readonly<Record<string, number>>;
  forcedIds: readonly string[];
  onWeight: (id: string, weight: number) => void;
  onForced: (id: string, forced: boolean) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="secret-backdrop" onClick={onClose}>
      <div
        className="secret-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="secret-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="secret-heading">
          <h2 id="secret-title">🤫 Geheim paneel</h2>
          <button aria-label="Sluiten" onClick={onClose}>
            ×
          </button>
        </div>
        <p>
          Weegfactor blijft staan tot je 'm terugzet. Force-win schakelt zichzelf
          na één draai weer uit. Je mag meerdere force-wins aanzetten — zijn er
          meer dan raderen, dan wordt er willekeurig uit gekozen.
        </p>
        {people.length ? (
          <ul>
            {people.map((person) => (
              <li key={person.id}>
                <span>{person.name}</span>
                <label>
                  Kans
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={weights[person.id] ?? 1}
                    onChange={(event) => {
                      const value = event.target.valueAsNumber;
                      if (Number.isFinite(value) && value >= 0)
                        onWeight(person.id, value);
                    }}
                    aria-label={`Kans voor ${person.name}`}
                  />
                  ×
                </label>
                <label className="secret-force">
                  <input
                    type="checkbox"
                    checked={forcedIds.includes(person.id)}
                    onChange={(event) =>
                      onForced(person.id, event.target.checked)
                    }
                  />
                  Force-win
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p>Voeg eerst deelnemers toe.</p>
        )}
      </div>
    </div>
  );
}
