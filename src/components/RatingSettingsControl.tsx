import {
  DEFAULT_RATING_SETTINGS,
  type RatingSettings,
} from "../../shared/ratings";
export function RatingSettingsControl({
  value = DEFAULT_RATING_SETTINGS,
  disabled = false,
  onChange,
  defaults = false,
}: {
  value?: RatingSettings;
  disabled?: boolean;
  defaults?: boolean;
  onChange: (value: RatingSettings) => void;
}) {
  return (
    <fieldset className="rating-settings" disabled={disabled}>
      <label className="rating-toggle">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        <span>
          <strong>
            {defaults ? "Beoordelingen standaard aan" : "Geef de haler sterren"}
          </strong>
          <small>Een beetje waardering voor de volgende ronde.</small>
        </span>
        <span className="rating-settings-icon" aria-hidden="true">
          ★
        </span>
      </label>
      {value.enabled && (
        <div className="rating-delay">
          <label>
            Beoordelen vanaf{" "}
            <input
              type="number"
              min="1"
              max="30"
              value={value.delayMinutes}
              onChange={(e) => {
                const delayMinutes = Number(e.target.value);
                if (
                  Number.isInteger(delayMinutes) &&
                  delayMinutes >= 1 &&
                  delayMinutes <= 30
                )
                  onChange({ ...value, delayMinutes });
              }}
            />{" "}
            minuten na de trekking
          </label>
          <small>
            Alleen Slack-deelnemers kunnen stemmen. Eén keer per trekking, tot
            de sessie verloopt.
          </small>
        </div>
      )}
    </fieldset>
  );
}
