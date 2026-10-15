import { useState } from "react";
import {
  channelApps,
  parseChannelInput,
  type ChannelApp,
  type ChannelVariant,
} from "../../shared/channel";
import {
  channelBindUrl,
  type ChannelBindFailure,
  type MemberLoginFailure,
} from "../sessions/ChannelClient";
import { configuredApiUrl } from "../sessions/liveNavigation";
import { RoundExplainer } from "./RoundExplainer";
import { ChannelTheme } from "./ChannelTheme";
function bindFailure(failure: ChannelBindFailure, app: ChannelApp): string {
  const { name, bot } = channelApps[app];
  return {
    denied: "Inloggen bij Slack is geannuleerd.",
    forbidden: `Alleen volwaardige leden van de workspace kunnen een ${name} koppelen. Gasten en externe gebruikers kunnen wel meedoen.`,
    expired:
      "Het inloggen duurde te lang of is in een ander tabblad gestart. Probeer opnieuw.",
    unavailable: `Slack is nu niet bereikbaar of het ${name} is nog niet ingesteld.`,
    busy: "Even rustig aan. Probeer over een minuut opnieuw.",
    not_in_channel: `Het ${name} kon niet in dit kanaal posten. Nodig eerst de bot uit met /invite ${bot} en probeer opnieuw.`,
  }[failure];
}
/** The theme a page of an app shows before it knows the latest round. */
export const idleVariant = (app: ChannelApp): ChannelVariant =>
  app === "beer" ? "beer" : "coffee";

/** Bind a wheel to a Slack channel: Sign in with Slack, then a test post. */
export function ChannelBindPage({
  app = "coffee",
  failure,
}: {
  app?: ChannelApp;
  failure?: ChannelBindFailure;
}) {
  const api = configuredApiUrl();
  const [input, setInput] = useState("");
  const channel = parseChannelInput(input);
  const { name, icon, bot, local } = channelApps[app];
  const beer = app === "beer";
  return (
    <ChannelTheme variant={idleVariant(app)} title={`${name} koppelen`}>
      <div className="unavailable channel-page">
        <h1>
          {beer ? "🍻" : "☕💧🍪"} {name} aan een kanaal koppelen
        </h1>
        <ol className="channel-steps">
          <li>
            Nodig de {name}-bot uit in het kanaal: typ daar{" "}
            <code>/invite {bot}</code>.
          </li>
          <li>
            Kopieer de link van het kanaal (rechtsklik op de kanaalnaam →{" "}
            <em>Kopiëren</em> → <em>Link kopiëren</em>) en plak hem hieronder.
          </li>
          <li>
            Log in met Slack. Het {name} plaatst dan een bevestiging in het
            kanaal.
          </li>
        </ol>
        {failure && <p role="alert">{bindFailure(failure, app)}</p>}
        {api ? (
          <form
            className="channel-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (channel) location.assign(channelBindUrl(api, app, channel));
            }}
          >
            <label htmlFor="channel-link">Kanaallink</label>
            <input
              id="channel-link"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://jouwbedrijf.slack.com/archives/C…"
              autoComplete="off"
              spellCheck={false}
            />
            {input && !channel && (
              <small role="status">
                Dit lijkt geen link naar een Slack-kanaal.
              </small>
            )}
            <button className="primary" type="submit" disabled={!channel}>
              Log in en koppel {icon}
            </button>
          </form>
        ) : (
          <p>Koppelen is hier nog niet ingesteld.</p>
        )}
        {beer ? (
          <>
            <p className="helper">
              Wie daarna <code>/bierrad</code> typt in het kanaal, start een
              bierronde: standaard vandaag om 15:45 met twee halers.
            </p>
            <RoundExplainer app="beer" />
          </>
        ) : (
          <>
            <p className="helper">
              Iedere afdeling kan een eigen kanaal koppelen. Wie{" "}
              <code>/koffierad</code>, <code>/waterrad</code> of{" "}
              <code>/koekrad</code> typt in het kanaal, start een koffie-,
              water- of koekronde.
            </p>
            <RoundExplainer />
          </>
        )}
        <p>
          <a href={local}>Liever handmatig draaien</a>
        </p>
      </div>
    </ChannelTheme>
  );
}

const memberFailures: Record<MemberLoginFailure, string> = {
  denied: "Inloggen bij Slack is geannuleerd.",
  forbidden:
    "Alleen volwaardige leden van de workspace kunnen inloggen om te beoordelen. Meekijken kan altijd.",
  expired:
    "Het inloggen duurde te lang, is in een ander tabblad gestart of de kanaallink is vervangen.",
  unavailable: "Slack is nu niet bereikbaar. Probeer het zo opnieuw.",
  busy: "Er loggen nu veel mensen tegelijk in. Probeer over een minuut opnieuw.",
};
/** Where a failed personal login lands; it has no channel link to go back to. */
export function ChannelMemberFailurePage({
  app = "coffee",
  failure,
}: {
  app?: ChannelApp;
  failure: MemberLoginFailure;
}) {
  return (
    <ChannelTheme variant={idleVariant(app)} title="Inloggen mislukt">
      <div className="unavailable channel-page">
        <h1>{channelApps[app].icon} Inloggen lukte niet</h1>
        <p role="alert">{memberFailures[failure]}</p>
        <p>
          Open de ronde opnieuw via de oproep in Slack en probeer het nog eens.
        </p>
      </div>
    </ChannelTheme>
  );
}
