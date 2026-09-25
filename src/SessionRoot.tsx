import { useEffect, useState, useSyncExternalStore } from "react";
import App from "./App";
import { LocalSessionController } from "./sessions/LocalSessionController";
import {
  RemoteSessionController,
  createLiveSession,
} from "./sessions/RemoteSessionController";
import { ManualParticipantSource } from "./services/ManualParticipantSource";
import { LocalWinnerCountPreference } from "./services/WinnerCountPreference";
import {
  configuredApiUrl,
  liveLink,
  parseLiveRoute,
} from "./sessions/liveNavigation";

export function SessionRoot() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  const invite = /^#\/slack-start\/([a-f0-9]{64})$/.exec(hash);
  return invite ? (
    <SlackStart key={hash} capability={invite[1]} />
  ) : (
    <SessionPage key={hash} hash={hash} />
  );
}
function SessionPage({ hash }: { hash: string }) {
  const apiUrl = configuredApiUrl();
  const route = parseLiveRoute(hash);
  const [controller, setController] = useState<
    LocalSessionController | RemoteSessionController
  >();
  useEffect(() => {
    if (hash && (!route || !apiUrl)) return;
    let current: LocalSessionController | RemoteSessionController;
    if (route && apiUrl)
      current = new RemoteSessionController({ ...route, apiUrl });
    else {
      const source = new ManualParticipantSource();
      current = new LocalSessionController({
        source,
        preference: new LocalWinnerCountPreference(),
        saveParticipants: (p) => source.save(p),
      });
    }
    setController(current);
    void current.initialize();
    return () => current.dispose();
  }, [hash, apiUrl]);
  if (hash && (!route || !apiUrl))
    return (
      <div className="unavailable">
        <h1>🍻 Live Bierrad is niet beschikbaar.</h1>
        <p>
          Deze link is ongeldig of live meekijken is hier nog niet ingesteld.
        </p>
        <a href="./">Open een lokaal Bierrad</a>
      </div>
    );
  if (!controller)
    return <p className="notice">Het Bierrad wordt klaargezet…</p>;
  return (
    <>
      <LiveBar
        controller={controller}
        apiUrl={apiUrl}
        spectatorCapability={route?.spectatorCapability}
      />
      <App controller={controller} />
    </>
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
      const created = await createLiveSession(apiUrl);
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
  return (
    <div className="live-bar">
      <span>
        {!live
          ? "Alleen op dit scherm"
          : live.role === "host"
            ? "● Jij organiseert · Live Bierrad"
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
          Start live Bierrad ↗
        </button>
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
                "Dit live Bierrad beëindigen? Alle kijklinks vervallen en de deelnemers worden gewist.",
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
      {live && <a href="./">Eigen Bierrad</a>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}

function SlackStart({ capability }: { capability: string }) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const api = configuredApiUrl();
  return (
    <div className="unavailable">
      <h1>🍻 Jouw vrijdag begint hier.</h1>
      <p>
        Start een tijdelijk live Bierrad met Slack. Bewaar deze startlink voor
        organisatoren; deel straks alleen de kijklink.
      </p>
      <button
        className="primary"
        disabled={pending || !api}
        onClick={() => {
          setPending(true);
          setError("");
          void createLiveSession(api!, capability)
            .then((created) => {
              location.replace(
                `${location.pathname}#/host/${created.hostCapability}/${created.spectatorCapability}`,
              );
            })
            .catch(() => {
              setError(
                "Deze startlink is verlopen, ingetrokken of Slack is nog niet ingesteld.",
              );
              setPending(false);
            });
        }}
      >
        {pending ? "Klaarzetten…" : "Start Bierrad met Slack 🍻"}
      </button>
      {error && <p role="alert">{error}</p>}
      <p>
        <a href="./">Liever handmatig draaien</a>
      </p>
    </div>
  );
}
