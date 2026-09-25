export function WinnerCountControl({
  count,
  max,
  disabled,
  readOnly,
  onChange,
}: {
  count: number;
  max: number;
  disabled: boolean;
  readOnly: boolean;
  onChange: (count: number) => void;
}) {
  return (
    <div className="winner-count-control">
      <span id="winner-count-label">Aantal bierhalers</span>
      <div
        className="count-stepper"
        role="group"
        aria-labelledby="winner-count-label"
      >
        {!readOnly && (
          <button
            type="button"
            aria-label="Minder bierhalers"
            disabled={disabled || count <= 1}
            onClick={() => onChange(count - 1)}
          >
            −
          </button>
        )}
        <output aria-live="polite" aria-label="Aantal bierhalers">
          {count}
        </output>
        {!readOnly && (
          <button
            type="button"
            aria-label="Meer bierhalers"
            disabled={disabled || count >= max}
            onClick={() => onChange(count + 1)}
          >
            +
          </button>
        )}
      </div>
      <small>
        {max
          ? `Uit ${max} ${max === 1 ? "deelnemer" : "deelnemers"}`
          : "Voeg je vrijdagploeg toe"}
      </small>
    </div>
  );
}
