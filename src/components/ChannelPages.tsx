import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  DEFAULT_RATING_SETTINGS,
  type RatingSettings,
} from "../../shared/ratings";
import { RatingSettingsControl } from "./RatingSettingsControl";
import {
  channelCopy,
  channelVariants,
  DEFAULT_ROUND_MINUTES,
  MAX_ROUND_MINUTES,
  ROUND_MINUTE_CHOICES,
  parseChannelInput,
  type ChannelCommand,
  type ChannelRound,
  type ChannelStatus,
  type ChannelVariant,
} from "../../shared/channel";
import { themes } from "../../shared/variant";
import { VariantContext } from "../Theme";
import {
  channelBindUrl,
  ChannelApiError,
  channelLink,
  channelRequest,
  channelViewLink,
  type ChannelBindFailure,
} from "../sessions/ChannelClient";
import { configuredApiUrl } from "../sessions/liveNavigation";
import { RemoteSessionController } from "../sessions/RemoteSessionController";
import App from "../App";
import { TimeLeft } from "./TimeLeft";

const clock = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
});
/** The name arrives with the first `/koffierad` or `/waterrad`; until then, no name. */
function channelTitle(variant: ChannelVariant, name?: string) {
  const { icon, name: wheel } = themes[variant];
  return name
    ? `${icon} ${wheel} van #${name}`
    : `${icon} ${wheel} van dit kanaal`;
}
/** One binding serves coffee and water: the page follows the latest round. */
function ChannelTheme({
  variant,
  title,
  children,
}: {
  variant: ChannelVariant;
  title?: string;
  children: ReactNode;
}) {
  const theme = themes[variant];
  useEffect(() => {
    document.documentElement.dataset.variant = variant;
    document.title = title ?? theme.name;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = theme.favicon;
  }, [variant, title, theme]);
  return (
    <VariantContext.Provider value={variant}>
      {children}
    </VariantContext.Provider>
  );
}
function roundLabel(variant: ChannelVariant) {
  const round = channelCopy[variant].round;
  return `${round[0].toUpperCase()}${round.slice(1)}`;
}
const bindFailures: Record<ChannelBindFailure, string> = {
  denied: "Inloggen bij Slack is geannuleerd.",
  forbidden:
    "Alleen volwaardige leden van de workspace kunnen een Koffierad koppelen. Gasten en externe gebruikers kunnen wel meedoen.",
  expired:
    "Het inloggen duurde te lang of is in een ander tabblad gestart. Probeer opnieuw.",
  unavailable:
    "Slack is nu niet bereikbaar of het Koffierad is nog niet ingesteld.",
  busy: "Even rustig aan. Probeer over een minuut opnieuw.",
  not_in_channel:
    "Het Koffierad kon niet in dit kanaal posten. Nodig eerst de bot uit met /invite @Koffierad en probeer opnieuw.",
};

/** Bind a Koffierad to a Slack channel: Sign in with Slack, then a test post. */
export function ChannelBindPage({ failure }: { failure?: ChannelBindFailure }) {
  const api = configuredApiUrl();
  const [input, setInput] = useState("");
  const channel = parseChannelInput(input);
  return (
    <ChannelTheme variant="coffee" title="Koffierad koppelen">
      <div className="unavailable channel-page">
        <h1>☕💧 Koffierad aan een kanaal koppelen</h1>
        <ol className="channel-steps">
          <li>
            Nodig de Koffierad-bot uit in het kanaal: typ daar{" "}
            <code>/invite @Koffierad</code>.
          </li>
          <li>
            Kopieer de link van het kanaal (rechtsklik op de kanaalnaam →{" "}
            <em>Kopiëren</em> → <em>Link kopiëren</em>) en plak hem hieronder.
          </li>
          <li>
            Log in met Slack. Het Koffierad plaatst dan een bevestiging in het
            kanaal.
          </li>
        </ol>
        {failure && <p role="alert">{bindFailures[failure]}</p>}
        {api ? (
          <form
            className="channel-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (channel) location.assign(channelBindUrl(api, channel));
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
              Log in en koppel ☕
            </button>
          </form>
        ) : (
          <p>Koppelen is hier nog niet ingesteld.</p>
        )}
        <p className="helper">
          Iedere afdeling kan een eigen kanaal koppelen. Wie de aanvraaglink
          heeft of <code>/koffierad</code> of <code>/waterrad</code> typt in het
          kanaal, kan een koffie- of waterronde starten.
        </p>
        <p>
          <a href="#/coffee">Liever handmatig draaien</a>
        </p>
      </div>
    </ChannelTheme>
  );
}

/** Request a round (everyone with the link) and, for admins, manage the binding. */
export function ChannelWheelPage({
  capability,
  requestCapability,
}: {
  capability: string;
  requestCapability?: string;
}) {
  const api = configuredApiUrl();
  const [status, setStatus] = useState<ChannelStatus>();
  const [minutes, setMinutes] = useState<number>();
  const [ratingSettings, setRatingSettings] = useState<RatingSettings>();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [gone, setGone] = useState(false);
  const live = useRoundController(api, status?.round?.spectatorCapability);
  const run = useCallback(
    async (command?: ChannelCommand) => {
      if (!api) return;
      const result = await channelRequest(api, capability, command);
      if (result.type === "unbound") {
        setGone(true);
        return result;
      }
      if (result.type === "view") throw new ChannelApiError("unavailable");
      setStatus(result.status);
      return result;
    },
    [api, capability],
  );
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void run().catch((error: Error) => {
        if (!active) return;
        setNotice(error.message);
        if ((error as { code?: string }).code === "unavailable") setGone(true);
      });
    refresh();
    // Picks up rounds started elsewhere (for example with /koffierad or /waterrad).
    const timer = setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [run]);
  async function act(command: ChannelCommand, done?: string) {
    setPending(true);
    setNotice("");
    try {
      const result = await run(command);
      if (result?.type === "rotated")
        location.replace(
          `#/koffie-beheer/${capability}/${result.requestCapability}`,
        );
      if (done) setNotice(done);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  }
  if (!api || gone)
    return (
      <ChannelTheme variant={status?.variant ?? "coffee"}>
        <div className="unavailable channel-page">
          <h1>☕ Dit Koffierad is niet beschikbaar.</h1>
          <p>
            {gone
              ? "De koppeling is opgeheven of deze link is vervangen. Vraag de beheerder van het kanaal om de nieuwe link."
              : "Live koffie- en waterrondes zijn hier nog niet ingesteld."}
          </p>
          <a href="#/coffee">Open een lokaal Koffierad</a>
        </div>
      </ChannelTheme>
    );
  if (!status)
    return (
      <ChannelTheme variant="coffee">
        <div className="unavailable channel-page">
          <p className="notice">{notice || "Het rad wordt gezet…"}</p>
        </div>
      </ChannelTheme>
    );
  const variant = status.round?.variant ?? status.variant ?? "coffee";
  const chosen = minutes ?? status.defaultMinutes ?? DEFAULT_ROUND_MINUTES;
  const choices = [
    ...new Set([...ROUND_MINUTE_CHOICES, status.defaultMinutes]),
  ].sort((a, b) => a - b);
  const request = (kind: ChannelVariant) =>
    void act({
      type: "requestRound",
      minutes: chosen,
      variant: kind,
      ratingSettings:
        ratingSettings ?? status.ratingSettings ?? DEFAULT_RATING_SETTINGS,
    });
  const admin = status.role === "admin" && (
    <ChannelAdmin
      status={status}
      requestCapability={requestCapability}
      pending={pending}
      act={act}
      setNotice={setNotice}
    />
  );
  // The fixed channel page: the latest round's live wheel, then the next request.
  if (status.round)
    return (
      <ChannelTheme variant={variant}>
        <div className="channel-live">
          <div className="channel-strip" aria-live="polite">
            <strong>{channelTitle(variant, status.channelName)}</strong>
            {status.round.active ? (
              <span>
                {roundLabel(variant)}! Het rad draait om{" "}
                {clock.format(Date.parse(status.round.startAt))}
                <ServerTimeLeft
                  controller={live}
                  startAt={Date.parse(status.round.startAt)}
                />
                . Klik op{" "}
                {themes[variant].icon} onder de oproep in Slack om mee te doen.
              </span>
            ) : (
              <span className="channel-strip-request">
                <label>
                  Nieuwe ronde over{" "}
                  <select
                    value={chosen}
                    disabled={pending}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  >
                    {choices.map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </label>
                {channelVariants.map((kind) => (
                  <button
                    key={kind}
                    className="primary"
                    disabled={pending || status.roundsLeft === 0}
                    onClick={() => request(kind)}
                  >
                    {themes[kind].icon} {roundLabel(kind)}
                  </button>
                ))}
              </span>
            )}
            {notice && <small role="status">{notice}</small>}
            {status.viewerCapability && (
              <small className="channel-view-link">
                Op een ander scherm meekijken:{" "}
                <code>{channelViewLink(status.viewerCapability)}</code>
              </small>
            )}
          </div>
          {!status.round.active && (
            <div className="channel-rating-options">
              <RatingSettingsControl
                value={ratingSettings ?? status.ratingSettings}
                disabled={pending}
                onChange={setRatingSettings}
              />
            </div>
          )}
          <ChannelLive key={status.round.spectatorCapability} controller={live} />
        </div>
        {admin && <div className="unavailable channel-page">{admin}</div>}
      </ChannelTheme>
    );
  return (
    <ChannelTheme variant={variant}>
      <div className="unavailable channel-page">
        <span className="friday-badge">
          {channelTitle(variant, status.channelName)}
        </span>
        <h1>Tijd voor koffie of water?</h1>
        <section className="channel-request">
          <p>
            Er komt een oproep in het Slack-kanaal. Wie op ☕ of 💧 klikt, doet
            mee. Na de wachttijd draait het rad hier en kiest het één haler.
            Deze pagina blijft altijd het rad van dit kanaal.
          </p>
          <fieldset className="minute-choices">
            <legend>Het rad draait over</legend>
            {choices.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={m === chosen}
                onClick={() => setMinutes(m)}
              >
                {m} min
              </button>
            ))}
          </fieldset>
          <RatingSettingsControl
            value={ratingSettings ?? status.ratingSettings}
            disabled={pending}
            onChange={setRatingSettings}
          />
          {channelVariants.map((kind) => (
            <button
              key={kind}
              className="primary spin-button"
              data-variant={kind}
              disabled={pending || status.roundsLeft === 0}
              onClick={() => request(kind)}
            >
              {themes[kind].icon} VRAAG EEN{" "}
              {channelCopy[kind].round.toUpperCase()} AAN
            </button>
          ))}
          {status.roundsLeft === 0 && (
            <p className="helper">
              Vandaag zijn er genoeg rondes geweest. Morgen weer!
            </p>
          )}
        </section>
        {notice && <p role="status">{notice}</p>}
        <p className="helper">
          Liever vanuit Slack? Typ <code>/koffierad</code> of{" "}
          <code>/waterrad</code> in het kanaal, met bijvoorbeeld{" "}
          <code>/waterrad 10</code> voor tien minuten.
        </p>
        {status.viewerCapability && (
          <p className="helper">
            Op een ander scherm meekijken, zonder rondes te kunnen starten? Typ
            daar{" "}
            <code className="channel-view-link">
              {channelViewLink(status.viewerCapability)}
            </code>
          </p>
        )}
        {admin}
      </div>
    </ChannelTheme>
  );
}

/** The view-only word link: the latest round's wheel, nothing to request or manage. */
export function ChannelViewPage({ capability }: { capability: string }) {
  const api = configuredApiUrl();
  const [round, setRound] = useState<ChannelRound | null>();
  const [channelName, setChannelName] = useState<string>();
  const [shown, setShown] = useState<ChannelVariant>("coffee");
  const [gone, setGone] = useState(false);
  const live = useRoundController(api, round?.spectatorCapability);
  useEffect(() => {
    if (!api) return;
    let active = true;
    const refresh = () =>
      void channelRequest(api, capability).then(
        (result) => {
          if (active && result.type === "view") {
            setRound(result.round ?? null);
            setChannelName(result.channelName);
            setShown(result.round?.variant ?? result.variant ?? "coffee");
          }
        },
        (error: Error) => {
          if (active && (error as { code?: string }).code === "unavailable")
            setGone(true);
        },
      );
    refresh();
    const timer = setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [api, capability]);
  if (!api || gone)
    return (
      <ChannelTheme variant={shown}>
        <div className="unavailable channel-page">
          <h1>☕ Dit Koffierad is niet beschikbaar.</h1>
          <p>
            {gone
              ? "Deze meekijklink is vervangen of de koppeling is opgeheven. Vraag de beheerder van het kanaal om de nieuwe link."
              : "Live koffie- en waterrondes zijn hier nog niet ingesteld."}
          </p>
          <a href="#/coffee">Open een lokaal Koffierad</a>
        </div>
      </ChannelTheme>
    );
  if (round === undefined)
    return (
      <ChannelTheme variant={shown}>
        <div className="unavailable channel-page">
          <p className="notice">Het rad wordt gezet…</p>
        </div>
      </ChannelTheme>
    );
  if (round)
    return (
      <ChannelTheme variant={shown}>
        <div className="channel-live">
          <div className="channel-strip" aria-live="polite">
            <strong>{channelTitle(shown, channelName)}</strong>
            <span>
              {round.active ? (
                <>
                  {roundLabel(shown)}! Het rad draait om{" "}
                  {clock.format(Date.parse(round.startAt))}
                  <ServerTimeLeft
                    controller={live}
                    startAt={Date.parse(round.startAt)}
                  />
                  . Klik op {themes[shown].icon} onder de oproep in Slack om
                  mee te doen.
                </>
              ) : (
                "Typ /koffierad of /waterrad in het kanaal voor een nieuwe ronde."
              )}
            </span>
          </div>
          <ChannelLive key={round.spectatorCapability} controller={live} />
        </div>
      </ChannelTheme>
    );
  return (
    <ChannelTheme variant={shown}>
      <div className="unavailable channel-page" aria-live="polite">
        <span className="friday-badge">{channelTitle(shown, channelName)}</span>
        <h1>Tijd voor koffie of water?</h1>
        <p>
          Typ <code>/koffierad</code> of <code>/waterrad</code> in het
          Slack-kanaal. Zodra er een ronde is, draait het rad hier vanzelf.
        </p>
      </div>
    </ChannelTheme>
  );
}

/**
 * One spectator connection per round, shared by the strip and the wheel so both
 * use the same corrected server clock. A new round gets a fresh controller.
 */
function useRoundController(apiUrl?: string, capability?: string) {
  const [live, setLive] = useState<{
    capability: string;
    controller: RemoteSessionController;
  }>();
  useEffect(() => {
    if (!apiUrl || !capability) return;
    const controller = new RemoteSessionController({
      apiUrl,
      capability,
      role: "spectator",
    });
    setLive({ capability, controller });
    void controller.initialize();
    return () => controller.dispose();
  }, [apiUrl, capability]);
  return live?.capability === capability ? live?.controller : undefined;
}
const noSubscription = () => () => {};
/** The strip's "· nog m:ss", on the round's server clock once it is known. */
function ServerTimeLeft({
  controller,
  startAt,
}: {
  controller?: RemoteSessionController;
  startAt: number;
}) {
  const offsetMs = useSyncExternalStore(
    controller?.subscribe ?? noSubscription,
    () => controller?.getSnapshot().clockOffsetMs ?? 0,
  );
  return <TimeLeft startAt={startAt} offsetMs={offsetMs} />;
}
/** The live wheel of one round, as a spectator; keyed per round so it remounts. */
function ChannelLive({ controller }: { controller?: RemoteSessionController }) {
  return controller ? (
    <App controller={controller} />
  ) : (
    <p className="notice">Het rad wordt klaargezet…</p>
  );
}

function ChannelAdmin({
  status,
  requestCapability,
  pending,
  act,
  setNotice,
}: {
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
              .writeText(channelLink(requestCapability))
              .then(
                () =>
                  setNotice(
                    "Link gekopieerd. Iedereen met deze link kan meekijken en een koffie- of waterronde starten.",
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
      <RatingSettingsControl
        value={status.ratingSettings}
        defaults
        disabled={pending}
        onChange={(settings) => {
          void act(
            { type: "setRatingDefaults", settings },
            "Standaardbeoordelingen opgeslagen.",
          );
        }}
      />
      <button
        disabled={pending}
        onClick={() => {
          if (
            window.confirm(
              "Een nieuwe kanaallink maken? De oude link en de oude meekijklink werken dan niet meer, ook niet als ze in Slack staan.",
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
              "Het Koffierad ontkoppelen? Alle links vervallen. Een lopende ronde draait nog af.",
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
