import { useEffect, useState } from "react";
import type { SlackHostStatus } from "../../shared/protocol";
export function SlackControls({
  status,
  locked,
  onImport,
  onManual,
}: {
  status: SlackHostStatus;
  locked: boolean;
  onImport: (link?: string) => Promise<void>;
  onManual: () => Promise<void>;
}) {
  const [tab, setTab] = useState(status.source),
    [link, setLink] = useState("");
  const [error, setError] = useState("");
  const busy = locked || status.importing;
  const run = async (action: () => Promise<void>) => {
    setError("");
    try {
      await action();
      setLink("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ophalen is niet gelukt.");
    }
  };
  return (
    <>
      <div className="source-tabs">
        <button
          aria-pressed={tab === "manual"}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              if (status.source === "slack") await onManual();
              setTab("manual");
            })
          }
        >
          ✎ Handmatig
        </button>
        <button
          aria-pressed={tab === "slack"}
          disabled={busy || !status.enabled}
          onClick={() => setTab("slack")}
        >
          Slack 🍻
        </button>
      </div>
      {!status.enabled && (
        <p className="storage-note">
          Slack-toegang is verlopen of nog niet ingesteld.
        </p>
      )}
      {tab === "slack" && (
        <div className="slack-import">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => onImport(link));
            }}
          >
            <label htmlFor="slack-link">Slack-bericht</label>
            <input
              id="slack-link"
              type="url"
              required
              maxLength={1024}
              value={link}
              onChange={(e) => setLink(e.target.value)}
              disabled={busy || !status.enabled}
              placeholder="Plak de Slack-berichtlink"
              autoComplete="off"
              spellCheck={false}
            />
            <p>We kijken naar 🍻 :beers: op het hoofdbericht.</p>
            <button
              className="primary"
              disabled={busy || !status.enabled || !link}
            >
              {status.importing
                ? "Deelnemers ophalen…"
                : "🍻 Deelnemers ophalen"}
            </button>
          </form>
          {status.source === "slack" && (
            <>
              <p role="status">
                {status.count === 0
                  ? "Niemand heeft met 🍻 gereageerd."
                  : `✓ Slack gekoppeld · ${status.count ?? 0} deelnemers`}
                <br />
                <small>
                  Laatst opgehaald:{" "}
                  {status.syncedAt
                    ? new Date(status.syncedAt).toLocaleTimeString("nl", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—"}
                </small>
              </p>
              <button
                disabled={busy || !status.enabled}
                onClick={() => void run(() => onImport())}
              >
                ↻ Opnieuw ophalen
              </button>
              <p className="storage-note">
                Verversen volgt de actuele reacties. Handmatig toegevoegde namen
                blijven. De officiële uitslag gaat automatisch naar deze thread.
              </p>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
export function SlackResultStatus({
  status,
  disabled,
  onRetry,
}: {
  status: SlackHostStatus;
  disabled: boolean;
  onRetry: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (status.result?.status !== "failed") return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [status.result?.status]);
  const result = status.result;
  if (!result) return null;
  const labels = {
    pending: "De officiële uitslag gaat na de trekking naar Slack.",
    posting: "De uitslag wordt naar Slack verstuurd…",
    posted: "✓ De uitslag staat in de Slack-thread.",
    failed: "De uitslag is geldig, maar posten in Slack is niet gelukt.",
    uncertain:
      "De uitslag is geldig. Controleer de Slack-thread: de aflevering is onzeker. We sturen niet opnieuw om dubbele berichten te voorkomen.",
  };
  return (
    <div className="slack-result" role="status">
      <p>{labels[result.status]}</p>
      {result.status === "failed" && status.enabled && (
        <button
          disabled={disabled || Date.now() < (result.retryAt ?? Infinity)}
          onClick={onRetry}
        >
          Opnieuw plaatsen
          {Date.now() < (result.retryAt ?? Infinity) ? " · even wachten" : ""}
        </button>
      )}
    </div>
  );
}
