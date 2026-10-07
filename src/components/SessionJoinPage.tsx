import { useCallback, useEffect, useState } from "react";
import { themes, type WheelVariant } from "../../shared/variant";
import type { JoinCommand, JoinStatus } from "../../shared/reviews";
import { VariantContext } from "../Theme";
import { configuredApiUrl } from "../sessions/liveNavigation";
import { RemoteSessionController } from "../sessions/RemoteSessionController";
import {
  joinRequest,
  JoinApiError,
  type JoinFailure,
} from "../sessions/JoinClient";
import App from "../App";
import {
  ReviewBallotCard,
  ReviewJoin,
  ReviewThanks,
  type ReviewDraft,
} from "./ReviewBallot";

function Themed({
  variant,
  children,
}: {
  variant: WheelVariant;
  children: React.ReactNode;
}) {
  const theme = themes[variant];
  useEffect(() => {
    document.documentElement.dataset.variant = variant;
    document.title = theme.name;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = theme.favicon;
  }, [variant, theme]);
  return (
    <VariantContext.Provider value={variant}>{children}</VariantContext.Provider>
  );
}

const failures: Record<JoinFailure, string> = {
  denied: "Inloggen bij Slack is geannuleerd.",
  forbidden:
    "Alleen volwaardige leden van de workspace kunnen inloggen om te beoordelen. Meekijken kan altijd.",
  expired:
    "Het inloggen duurde te lang, is in een ander tabblad gestart, of reviews staan voor deze sessie uit.",
  unavailable: "Slack is nu niet bereikbaar. Probeer het zo opnieuw.",
  busy: "Er loggen nu veel mensen tegelijk in. Probeer over een minuut opnieuw.",
};
export function JoinFailurePage({ failure }: { failure: JoinFailure }) {
  return (
    <Themed variant="beer">
      <div className="unavailable channel-page">
        <h1>🍻 Inloggen lukte niet</h1>
        <p role="alert">{failures[failure]}</p>
        <p>Open de ronde opnieuw via de link in de Slack-thread.</p>
      </div>
    </Themed>
  );
}

/**
 * A session's join link (watch, or log in to review) and the personal link
 * after logging in (watch and review). Both watch as spectators.
 */
export function SessionJoinPage({ capability }: { capability: string }) {
  const api = configuredApiUrl();
  const [status, setStatus] = useState<JoinStatus>();
  const [gone, setGone] = useState<false | "gone" | "loggedOut">(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [later, setLater] = useState<string>();
  const [draft, setDraft] = useState<ReviewDraft>();
  const [live, setLive] = useState<RemoteSessionController>();
  useEffect(() => {
    if (!api) return;
    const controller = new RemoteSessionController({
      apiUrl: api,
      capability,
      role: "spectator",
    });
    setLive(controller);
    void controller.initialize();
    return () => controller.dispose();
  }, [api, capability]);
  const run = useCallback(
    async (command?: JoinCommand) => {
      if (!api) return;
      const result = await joinRequest(api, capability, command);
      if (result.type === "loggedOut") setGone("loggedOut");
      else setStatus(result.status);
    },
    [api, capability],
  );
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void run().catch((error: JoinApiError) => {
        if (active && error.code === "unavailable") setGone("gone");
      });
    refresh();
    const timer = setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [run]);
  // Voting opens a minute after the finale: ask right then, and once more.
  const isMember = status?.role === "member";
  useEffect(() => {
    if (!live || !isMember) return;
    let finished = live.getSnapshot().session.state === "finished";
    const timers: ReturnType<typeof setTimeout>[] = [];
    const unsubscribe = live.subscribe(() => {
      const now = live.getSnapshot().session.state === "finished";
      if (now && !finished)
        for (const delay of [61000, 66000])
          timers.push(setTimeout(() => void run().catch(() => {}), delay));
      finished = now;
    });
    return () => {
      unsubscribe();
      timers.forEach(clearTimeout);
    };
  }, [live, isMember, run]);
  const variant = status?.variant ?? "beer";
  const theme = themes[variant];
  if (!api || gone)
    return (
      <Themed variant={variant}>
        <div className="unavailable channel-page">
          <h1>
            {gone === "loggedOut"
              ? `${theme.icon} Je bent uitgelogd.`
              : `${theme.icon} Deze ronde is niet beschikbaar.`}
          </h1>
          <p>
            {gone === "loggedOut"
              ? "Deze persoonlijke link werkt niet meer. Open de ronde opnieuw via de link in de Slack-thread."
              : gone
                ? "De sessie is voorbij of deze link werkt niet meer."
                : "Live rondes zijn hier nog niet ingesteld."}
          </p>
        </div>
      </Themed>
    );
  const ballot = status?.member?.ballot;
  const act = async (command: JoinCommand) => {
    setPending(true);
    setNotice("");
    try {
      await run(command);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <Themed variant={variant}>
      <div className="channel-live">
        <div className="channel-strip" aria-live="polite">
          <strong>
            {theme.icon} {theme.name}
          </strong>
          {status?.role === "join" && (
            <ReviewJoin
              apiUrl={api}
              capability={capability}
              path="/auth/slack/join"
              viewLink={`#/live/${capability}`}
              explanation="Log in om na afloop de halers te beoordelen."
            />
          )}
          {isMember && (
            <div className="member-bar">
              <span>✓ Ingelogd met Slack</span>
              {status?.member?.participating !== undefined && !ballot && (
                <span
                  className="member-chip"
                  data-in={status.member.participating}
                >
                  {status.member.participating
                    ? "Jij doet mee"
                    : `Reageer met ${theme.icon} in Slack om mee te doen`}
                </span>
              )}
              {ballot?.submitted && <ReviewThanks closesAt={ballot.closesAt} />}
              {ballot && !ballot.submitted && later === ballot.drawId && (
                <button className="primary" onClick={() => setLater(undefined)}>
                  ⭐ Beoordeel de halers
                </button>
              )}
              <button
                className="link-button"
                disabled={pending}
                onClick={() => void act({ type: "logout" })}
              >
                Uitloggen
              </button>
              <small className="member-hint">
                Dit is jouw persoonlijke link voor deze sessie: zet hem in je
                bladwijzers en deel hem niet.
              </small>
            </div>
          )}
          {notice && <small role="status">{notice}</small>}
        </div>
        {ballot && !ballot.submitted && later !== ballot.drawId && (
          <div className="review-overlay">
            <ReviewBallotCard
              key={ballot.drawId}
              ballot={ballot}
              variant={variant}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={async (submission) => {
                await run({ type: "review", drawId: ballot.drawId, ...submission });
                setDraft(undefined);
              }}
              onLater={() => setLater(ballot.drawId)}
            />
          </div>
        )}
        {live ? <App controller={live} /> : <p className="notice">Het rad wordt klaargezet…</p>}
      </div>
    </Themed>
  );
}
