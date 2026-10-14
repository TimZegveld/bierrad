import {
  channelApps,
  DEFAULT_BEER_WINNERS,
  MAX_BEER_WINNERS,
  MAX_ROUND_MINUTES,
  type ChannelApp,
  type ChannelStatus,
  type ChannelCommand,
} from "../../shared/channel";
import {
  DEFAULT_REVIEW_SETTINGS,
  REVIEW_MINUTE_CHOICES,
} from "../../shared/reviews";
import { channelLink } from "../sessions/ChannelClient";
export function ChannelAdmin({
  app,
  status,
  requestCapability,
  pending,
  act,
  setNotice,
}: {
  app: ChannelApp;
  status: ChannelStatus;
  requestCapability?: string;
  pending: boolean;
  act: (command: ChannelCommand, done?: string) => Promise<void>;
  setNotice: (text: string) => void;
}) {
  return (
    <section className="channel-admin">
      <h2>Beheer</h2>
      <p className="helper">
        Bewaar deze beheerpagina zelf; deel alleen de kanaallink (het vaste
        rad). Een koppeling verloopt na 90 dagen zonder rondes (nu tot{" "}
        {new Date(status.expiresAt).toLocaleDateString("nl-NL")}).
      </p>
      {requestCapability && (
        <button
          disabled={pending}
          onClick={() =>
            void navigator.clipboard
              .writeText(channelLink(app, requestCapability))
              .then(
                () =>
                  setNotice(
                    "Link gekopieerd. Iedereen met deze link kan meekijken en inloggen om te beoordelen.",
                  ),
                () => setNotice("Kopiëren lukt niet. Sta klembordtoegang toe."),
              )
          }
        >
          Kopieer kanaallink ⧉
        </button>
      )}
      {!status.viewerCapability && (
        <p className="helper">
          Maak een nieuwe kanaallink om ook een meekijklink in woorden te
          krijgen.
        </p>
      )}
      {app === "beer" ? (
        <label>
          Standaard aantal bierhalers{" "}
          <select
            value={status.defaultWinners ?? DEFAULT_BEER_WINNERS}
            disabled={pending}
            onChange={(e) =>
              void act(
                { type: "setDefaultWinners", winners: Number(e.target.value) },
                "Standaard aantal bierhalers opgeslagen.",
              )
            }
          >
            {Array.from({ length: MAX_BEER_WINNERS }, (_, i) => i + 1).map(
              (n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "bierhaler" : "bierhalers"}
                </option>
              ),
            )}
          </select>
        </label>
      ) : (
        <label>
          Standaardwachttijd{" "}
          <select
            value={status.defaultMinutes}
            disabled={pending}
            onChange={(e) =>
              void act(
                { type: "setDefaultMinutes", minutes: Number(e.target.value) },
                "Standaardwachttijd opgeslagen.",
              )
            }
          >
            {Array.from({ length: MAX_ROUND_MINUTES }, (_, i) => i + 1).map(
              (m) => (
                <option key={m} value={m}>
                  {m} {m === 1 ? "minuut" : "minuten"}
                </option>
              ),
            )}
          </select>
        </label>
      )}
      <label>
        Reviews standaard aan{" "}
        <input
          type="checkbox"
          checked={(status.reviews ?? DEFAULT_REVIEW_SETTINGS).enabled}
          disabled={pending}
          onChange={(e) =>
            void act(
              {
                type: "setReviews",
                enabled: e.target.checked,
                minutes: (status.reviews ?? DEFAULT_REVIEW_SETTINGS).minutes,
              },
              "Reviewinstelling opgeslagen.",
            )
          }
        />
      </label>
      <label>
        Stemmen kan
        <select
          value={(status.reviews ?? DEFAULT_REVIEW_SETTINGS).minutes}
          disabled={pending}
          onChange={(e) =>
            void act(
              {
                type: "setReviews",
                enabled: (status.reviews ?? DEFAULT_REVIEW_SETTINGS).enabled,
                minutes: Number(e.target.value),
              },
              "Reviewinstelling opgeslagen.",
            )
          }
        >
          {REVIEW_MINUTE_CHOICES.map((m) => (
            <option key={m} value={m}>
              {m} minuten na de trekking
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={pending}
        onClick={() => {
          if (
            window.confirm(
              "Een nieuwe kanaallink maken? De oude link, de oude meekijklink en alle persoonlijke links werken dan niet meer, ook niet als ze in Slack staan.",
            )
          )
            void act(
              { type: "rotateRequestLink" },
              "Nieuwe kanaallink gemaakt.",
            );
        }}
      >
        Nieuwe kanaallink
      </button>
      <button
        disabled={pending}
        onClick={() => {
          if (
            window.confirm(
              `Het ${channelApps[app].name} ontkoppelen? Alle links vervallen. Een lopende ronde draait nog af.`,
            )
          )
            void act({ type: "unbind" });
        }}
      >
        Ontkoppelen
      </button>
    </section>
  );
}
