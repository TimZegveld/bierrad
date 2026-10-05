import { VariantContext, useTheme } from "./Theme";
import {
  localHash,
  localVariant,
  themes,
  wheelVariants,
  type WheelVariant,
} from "../shared/variant";
import { useEffect, useState, useSyncExternalStore } from "react";
import App from "./App";
import { RatingPage } from "./components/RatingPage";
import { LocalSessionController } from "./sessions/LocalSessionController";
import {
  RemoteSessionController,
  createLiveSession,
  seedLiveSession,
} from "./sessions/RemoteSessionController";
import { ManualParticipantSource } from "./services/ManualParticipantSource";
import { LocalWinnerCountPreference } from "./services/WinnerCountPreference";
import {
  configuredApiUrl,
  liveLink,
  parseLiveRoute,
} from "./sessions/liveNavigation";
import { parseChannelRoute } from "./sessions/ChannelClient";
import { isChannelVariant } from "../shared/channel";
import {
  ChannelBindPage,
  ChannelViewPage,
  ChannelWheelPage,
} from "./components/ChannelPages";

export function SessionRoot() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const rating = /^#\/rate\/([a-f0-9]{32}\.[a-f0-9]{64})$/.exec(hash);
  const ratingFailure =
    /^#\/rate-error\/(beer|coffee|water)\/(denied|forbidden|expired|unavailable|busy)$/.exec(
      hash,
    );
  if (rating || ratingFailure)
    return (
      <RatingPage
        key={hash}
        capability={rating?.[1]}
        variant={ratingFailure?.[1] as WheelVariant | undefined}
        failure={ratingFailure?.[2]}
      />
    );
  const channel = parseChannelRoute(hash);
  if (channel)
    return (
      <VariantContext.Provider value="coffee">
        {channel.page === "bind" ? (
          <ChannelBindPage key={hash} failure={channel.failure} />
        ) : channel.page === "view" ? (
          <ChannelViewPage key={hash} capability={channel.capability} />
        ) : (
          <ChannelWheelPage
            key={hash}
            capability={channel.capability}
            requestCapability={channel.requestCapability}
          />
        )}
      </VariantContext.Provider>
    );
  const login = slackLoginRoute(hash);
  return login ? (
    <VariantContext.Provider value={login.variant}>
      <SlackLogin key={hash} failure={login.failure} />
    </VariantContext.Provider>
  ) : (
    <SessionPage key={hash} hash={hash} />
  );
}
function SessionPage({ hash }: { hash: string }) {
  const local = localVariant(hash);
  const variant: WheelVariant = local ?? "beer";
  const apiUrl = configuredApiUrl();
  const route = parseLiveRoute(hash);
  const [controller, setController] = useState<
    LocalSessionController | RemoteSessionController
  >();
  useEffect(() => {
    if (!local && (!route || !apiUrl)) return;
    let current: LocalSessionController | RemoteSessionController;
    if (route && apiUrl)
      current = new RemoteSessionController({ ...route, apiUrl });
    else {
      const source = new ManualParticipantSource(variant);
      current = new LocalSessionController({
        freshStart: true,
        source,
        preference: new LocalWinnerCountPreference(variant),
        saveParticipants: (p) => source.save(p),
      });
    }
    setController(current);
    void current.initialize();
    return () => current.dispose();
  }, [hash, apiUrl]);
  if (!local && (!route || !apiUrl))
    return (
      <div className="unavailable">
        <h1>🍻 Live Bierrad is niet beschikbaar.</h1>
        <p>
          Deze link is ongeldig of live meekijken is hier nog niet ingesteld.
        </p>
        <a href="./">Open een lokaal Bierrad</a>
      </div>
    );
  if (!controller) return <p className="notice">Het rad wordt klaargezet…</p>;
  return (
    <SessionTheme controller={controller} fallback={variant}>
      <LiveBar
        controller={controller}
        apiUrl={apiUrl}
        spectatorCapability={route?.spectatorCapability}
      />
      <App controller={controller} />
    </SessionTheme>
  );
}
function SessionTheme({
  controller,
  fallback,
  children,
}: {
  controller: LocalSessionController | RemoteSessionController;
  fallback: WheelVariant;
  children: import("react").ReactNode;
}) {
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const variant = snapshot.session.variant ?? fallback;
  useEffect(() => {
    document.documentElement.dataset.variant = variant;
    document.title = themes[variant].name + " — Wie haalt de volgende ronde?";
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = themes[variant].favicon;
  }, [variant]);
  return (
    <VariantContext.Provider value={variant}>
      {children}
    </VariantContext.Provider>
  );
}
function LiveBar({
  controller,
  apiUrl,
  spectatorCapability,
}: {
  controller: LocalSessionController | RemoteSessionController;
  apiUrl?: string;
  spectatorCapability?: string;
}) {
  const theme = useTheme();
  const { live, capabilities } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  async function create() {
    if (!apiUrl) return;
    setPending(true);
    setNotice("");
    try {
      const { participants, winnerCount } = controller.getSnapshot().session;
      const created = await createLiveSession(apiUrl, theme.variant);
      // Carry the wheel the host already set up into the new live session.
      seedLiveSession(created.hostCapability, {
        names: participants.map((p) => p.name),
        winnerCount,
      });
      // Fragment survives reload, but is never sent to Pages or stored in web storage.
      location.hash = `/host/${created.hostCapability}/${created.spectatorCapability}`;
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Live starten is niet gelukt.",
      );
    } finally {
      setPending(false);
    }
  }
  // Spectators get their own presentation header inside SpectatorView.
  if (live?.role === "spectator") return null;
  return (
    <div className="live-bar">
      <span>
        {!live
          ? "Alleen op dit scherm"
          : live.role === "host"
            ? `● Jij organiseert · Live ${theme.name}`
            : "● Je kijkt live mee"}
      </span>
      {live && (
        <small role="status">
          {
            {
              connecting: "Verbinden…",
              connected: "Verbonden",
              reconnecting: "Verbinding herstellen…",
              unavailable: "Afgelopen",
            }[live.status]
          }
        </small>
      )}
      {!live && apiUrl && (
        <button
          disabled={pending || !capabilities.canReset}
          onClick={() => void create()}
        >
          Start live {theme.name} ↗
        </button>
      )}
      {!live && apiUrl && (
        <a
          className="button-link"
          href={slackLoginUrl(apiUrl, theme.variant)}
          rel="noreferrer"
        >
          Start met Slack {theme.icon}
        </a>
      )}
      {!live && apiUrl && isChannelVariant(theme.variant) && (
        <a className="button-link" href="#/koffie-koppelen">
          Koppel aan een Slack-kanaal {theme.icon}
        </a>
      )}
      {live?.role === "host" &&
        live.status !== "unavailable" &&
        spectatorCapability && (
          <button
            onClick={() => {
              void navigator.clipboard
                .writeText(liveLink("spectator", spectatorCapability))
                .then(
                  () =>
                    setNotice(
                      "Kijklink gekopieerd. Iedereen met deze link kan tijdelijk meekijken.",
                    ),
                  () =>
                    setNotice(
                      "Kopiëren lukt niet. Sta klembordtoegang toe en probeer opnieuw.",
                    ),
                );
            }}
          >
            Kopieer kijklink ⧉
          </button>
        )}
      {live?.role === "host" && live.status === "connected" && (
        <button
          onClick={() => {
            if (
              window.confirm(
                `Dit live ${theme.name} beëindigen? Alle kijklinks vervallen en de deelnemers worden gewist.`,
              )
            )
              void (controller as RemoteSessionController)
                .endSession()
                .catch(() =>
                  setNotice("Beëindigen is niet gelukt. Probeer opnieuw."),
                );
          }}
        >
          Live beëindigen
        </button>
      )}
      {live && <a href={localHash(theme.variant)}>Eigen {theme.name}</a>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}

type SlackFailure = "denied" | "forbidden" | "expired" | "unavailable" | "busy";
const failures: Record<SlackFailure, string> = {
  denied: "Inloggen bij Slack is geannuleerd.",
  forbidden:
    "Alleen volwaardige leden van de workspace kunnen een Slack-rad starten. Gasten en externe gebruikers kunnen wel meekijken.",
  expired:
    "Het inloggen duurde te lang of is in een ander tabblad gestart. Probeer opnieuw.",
  unavailable: "Slack is nu niet bereikbaar of nog niet ingesteld.",
  busy: "Even rustig aan. Probeer over een minuut opnieuw.",
};
/** `#/slack` for beer, `#/<variant>-slack` otherwise, with an optional failure. */
function slackLoginRoute(
  hash: string,
): { variant: WheelVariant; failure?: SlackFailure } | undefined {
  const match =
    /^#\/(?:([a-z]+)-)?slack(?:\/(denied|forbidden|expired|unavailable|busy))?$/.exec(
      hash,
    );
  if (!match) return;
  const variant = match[1] ?? "beer";
  if (!wheelVariants.includes(variant as WheelVariant) || match[1] === "beer")
    return;
  return {
    variant: variant as WheelVariant,
    ...(match[2] ? { failure: match[2] as SlackFailure } : {}),
  };
}
function slackLoginUrl(api: string, variant: WheelVariant): string {
  return `${api}/auth/slack/${variant}`;
}
function SlackLogin({ failure }: { failure?: SlackFailure }) {
  const theme = useTheme();
  useEffect(() => {
    document.documentElement.dataset.variant = theme.variant;
    document.title = theme.name;
  }, [theme.variant, theme.name]);
  const api = configuredApiUrl();
  return (
    <div className="unavailable">
      <h1>
        {theme.icon} {theme.badge}.
      </h1>
      <p>
        Log in met Slack om een tijdelijk live {theme.name} te starten. Deel
        daarna alleen de kijklink.
      </p>
      {failure && <p role="alert">{failures[failure]}</p>}
      {api && (
        <a
          className="primary"
          href={slackLoginUrl(api, theme.variant)}
          rel="noreferrer"
        >
          Log in met Slack {theme.icon}
        </a>
      )}
      {isChannelVariant(theme.variant) && (
        <p>
          Liever een vast rad voor je afdeling, waar iedereen een koffie- of
          waterronde kan aanvragen?{" "}
          <a href="#/koffie-koppelen">Koppel het aan een Slack-kanaal</a>
        </p>
      )}
      <p>
        <a href={localHash(theme.variant)}>Liever handmatig draaien</a>
      </p>
    </div>
  );
}
