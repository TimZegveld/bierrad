import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  channelApps,
  DEFAULT_BEER_WINNERS,
  MAX_BEER_WINNERS,
  MAX_ROUND_MINUTES,
  roundCopy,
  parseChannelInput,
  type ChannelApp,
  type ChannelCommand,
  type ChannelRound,
  type ChannelStatus,
  type ChannelVariant,
} from "../../shared/channel";
import { themeFor, themes } from "../../shared/variant";
import {
  DEFAULT_REVIEW_SETTINGS,
  REVIEW_MINUTE_CHOICES,
} from "../../shared/reviews";
import { RoundTitleContext, VariantContext } from "../Theme";
import {
  channelBindUrl,
  ChannelApiError,
  channelLink,
  channelRequest,
  channelViewLink,
  channelViewRoute,
  type ChannelBindFailure,
  type MemberLoginFailure,
} from "../sessions/ChannelClient";
import {
  ReviewBallotCard,
  ReviewJoin,
  ReviewThanks,
  type ReviewDraft,
} from "./ReviewBallot";
import { RoundExplainer } from "./RoundExplainer";
import { RoundResult, useRoundOver } from "./RoundResult";
import { configuredApiUrl } from "../sessions/liveNavigation";
import { RemoteSessionController } from "../sessions/RemoteSessionController";
import App from "../App";
import { TimeLeft } from "./TimeLeft";

const clock = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  hour: "2-digit",
  minute: "2-digit",
});
const dayOf = new Intl.DateTimeFormat("nl-NL", {
  timeZone: "Europe/Amsterdam",
  weekday: "long",
  day: "numeric",
  month: "long",
});
const dayKey = (at: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam" }).format(at);
const today = (at: number) => dayKey(at) === dayKey(Date.now());
/** "om 15:45" today; a Bierrad round planned for another day names that day. */
function startLabel(startAt: number) {
  return today(startAt)
    ? `om ${clock.format(startAt)}`
    : `${dayOf.format(startAt)} om ${clock.format(startAt)}`;
}
/** What each app's channel pages tell people to type; display only. */
const appCopy: Record<
  ChannelApp,
  { idleTitle: string; again: string; idle: ReactNode; viewIdle: ReactNode }
> = {
  coffee: {
    idleTitle: "Tijd voor koffie, water of koek?",
    again: "Typ /koffierad, /waterrad of /koekrad in het kanaal voor een nieuwe ronde.",
    idle: (
      <>
        Typ <code>/koffierad</code>, <code>/waterrad</code> of{" "}
        <code>/koekrad</code> in het Slack-kanaal, bijvoorbeeld{" "}
        <code>/waterrad 10</code> voor tien minuten of{" "}
        <code>/koekrad taart 10</code> voor een taartronde. Wie op ☕, 💧 of
        🍪 onder de oproep klikt, doet mee. Na de wachttijd draait het rad
        hier vanzelf en kiest het één haler.
      </>
    ),
    viewIdle: (
      <>
        Typ <code>/koffierad</code>, <code>/waterrad</code> of{" "}
        <code>/koekrad</code> in het Slack-kanaal. Zodra er een ronde is, draait het rad hier vanzelf.
      </>
    ),
  },
  beer: {
    idleTitle: "Tijd voor de bierronde?",
    again: "Typ /bierrad in het kanaal voor een nieuwe bierronde.",
    idle: (
      <>
        Typ <code>/bierrad</code> in het Slack-kanaal: dan draait het rad
        vandaag om 15:45. Of kies zelf, bijvoorbeeld <code>/bierrad 16.00</code>{" "}
        of <code>/bierrad vrijdag 15.45 3</code> voor drie halers, en zet er
        gerust een eigen tekst achter. Wie op 🍻 onder de oproep klikt, doet
        mee. Op de gekozen tijd draait het rad hier vanzelf.
      </>
    ),
    viewIdle: (
      <>
        Typ <code>/bierrad</code> in het Slack-kanaal. Zodra er een bierronde
        is, draait het rad hier vanzelf.
      </>
    ),
  },
};
/** The name arrives with the first slash command; until then, no name. */
function channelTitle(variant: ChannelVariant, name?: string, word?: string) {
  const { icon, name: wheel } = themeFor(variant, word);
  return name ? `${icon} ${wheel} van #${name}` : `${icon} ${wheel} van dit kanaal`;
}
/** One binding serves coffee, water and cookie: the page follows the latest round. */
function ChannelTheme({
  variant,
  word,
  title,
  children,
}: {
  variant: ChannelVariant;
  /** Koekrad rounds: the round's word. */
  word?: string;
  title?: string;
  children: ReactNode;
}) {
  const theme = themeFor(variant, word);
  useEffect(() => {
    document.documentElement.dataset.variant = variant;
    document.title = title ?? theme.name;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = theme.favicon;
  }, [variant, title, theme]);
  return (
    <VariantContext.Provider value={variant}>
      <RoundTitleContext.Provider value={word}>{children}</RoundTitleContext.Provider>
    </VariantContext.Provider>
  );
}
function roundLabel(variant: ChannelVariant, word?: string) {
  const round = roundCopy(variant, word).round;
  return `${round[0].toUpperCase()}${round.slice(1)}`;
}
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
const idleVariant = (app: ChannelApp): ChannelVariant =>
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
        <h1>{beer ? "🍻" : "☕💧🍪"} {name} aan een kanaal koppelen</h1>
        <ol className="channel-steps">
          <li>
            Nodig de {name}-bot uit in het kanaal: typ daar{" "}
            <code>/invite {bot}</code>.
          </li>
          <li>
            Kopieer de link van het kanaal (rechtsklik op de kanaalnaam →{" "}
            <em>Kopiëren</em> → <em>Link kopiëren</em>) en plak hem hieronder.
          </li>
          <li>Log in met Slack. Het {name} plaatst dan een bevestiging in het kanaal.</li>
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
              <small role="status">Dit lijkt geen link naar een Slack-kanaal.</small>
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
              Iedere afdeling kan een eigen kanaal koppelen. Wie <code>/koffierad</code>,{" "}
              <code>/waterrad</code> of <code>/koekrad</code> typt in het kanaal,
              start een koffie-, water- of koekronde.
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
        <p>Open de ronde opnieuw via de oproep in Slack en probeer het nog eens.</p>
      </div>
    </ChannelTheme>
  );
}

/**
 * The channel's fixed wheel: watch, log in to review and, for admins, manage the
 * binding. Rounds start in Slack with a slash command, not here.
 */
export function ChannelWheelPage({
  app = "coffee",
  capability,
  requestCapability,
}: {
  app?: ChannelApp;
  capability: string;
  requestCapability?: string;
}) {
  const own = channelApps[app];
  const api = configuredApiUrl();
  const [status, setStatus] = useState<ChannelStatus>();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [gone, setGone] = useState<false | "gone" | "loggedOut">(false);
  /** A ballot put aside with "Later"; it stays one click away. */
  const [later, setLater] = useState<string>();
  /** The ballot being filled in; the card itself remounts when the round ends. */
  const [draft, setDraft] = useState<ReviewDraft>();
  const live = useRoundController(api, status?.round?.spectatorCapability);
  const over = useRoundOver(live, status?.round?.active ?? true);
  /** The round whose draw is being replayed, if any. */
  const [replayOf, setReplayOf] = useState<string>();
  const run = useCallback(
    async (command?: ChannelCommand) => {
      if (!api) return;
      const result = await channelRequest(api, capability, command);
      if (result.type === "unbound") {
        setGone("gone");
        return result;
      }
      if (result.type === "loggedOut") {
        setGone("loggedOut");
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
        if ((error as { code?: string }).code === "unavailable") setGone("gone");
      });
    refresh();
    // Picks up rounds started elsewhere (for example with /koffierad or /koekrad).
    const timer = setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [run]);
  // Voting opens a minute after the finale: a personal link asks for its
  // ballot right then instead of waiting for the next poll, and once more.
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
  async function act(command: ChannelCommand, done?: string) {
    setPending(true);
    setNotice("");
    try {
      const result = await run(command);
      if (result?.type === "rotated")
        location.replace(
          `#/${own.route}-beheer/${capability}/${result.requestCapability}`,
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
      <ChannelTheme variant={status?.variant ?? idleVariant(app)}>
        <div className="unavailable channel-page">
          <h1>
            {gone === "loggedOut"
              ? `${own.icon} Je bent uitgelogd.`
              : `${own.icon} Dit ${own.name} is niet beschikbaar.`}
          </h1>
          <p>
            {gone === "loggedOut"
              ? "Deze persoonlijke link werkt niet meer. Open een ronde via de oproep in Slack om opnieuw in te loggen."
              : gone
                ? "De koppeling is opgeheven of deze link is vervangen. Vraag de beheerder van het kanaal om de nieuwe link."
                : "Live kanaalrondes zijn hier nog niet ingesteld."}
          </p>
          <a href={own.local}>Open een lokaal {own.name}</a>
        </div>
      </ChannelTheme>
    );
  if (!status)
    return (
      <ChannelTheme variant={idleVariant(app)}>
        <div className="unavailable channel-page">
          <p className="notice">{notice || "Het rad wordt gezet…"}</p>
        </div>
      </ChannelTheme>
    );
  const variant = status.round?.variant ?? status.variant ?? idleVariant(app);
  const word = status.round?.title;
  const reviews = status.reviews ?? DEFAULT_REVIEW_SETTINGS;
  const member = status.role === "member";
  const ballot = status.member?.ballot;
  const submit = async (submission: { scores: number[]; texts: string[] }) => {
    await run({ type: "review", drawId: ballot!.drawId, ...submission });
    setDraft(undefined);
  };
  // Personal link: who you are (only to yourself), and your own ballot.
  const memberBar = member && (
    <div className="member-bar">
      <span>✓ Ingelogd met Slack</span>
      {status.round?.active && status.member?.participating !== undefined && (
        <span className="member-chip" data-in={status.member.participating}>
          {status.member.participating
            ? "Jij doet mee"
            : `Klik ${themes[variant].icon} in Slack om mee te doen`}
        </span>
      )}
      {ballot?.submitted && <ReviewThanks closesAt={ballot.closesAt} />}
      {ballot && !ballot.submitted && later === ballot.drawId && (
        <button className="primary" onClick={() => setLater(undefined)}>
          ⭐ Beoordeel {variant === "beer" ? "de halers" : "de haler"}
        </button>
      )}
      <button
        className="link-button"
        disabled={pending}
        onClick={() => void act({ type: "logout" })}
      >
        Uitloggen
      </button>
      <details className="member-hint">
        <summary aria-label="Over deze link">ⓘ</summary>
        Dit is jouw persoonlijke link, 30 dagen geldig: zet hem in je
        bladwijzers en deel hem niet.
      </details>
    </div>
  );
  // Always the first child and fixed on screen, in both layouts below, so the
  // ballot stays put when the round ends and the page drops the wheel.
  const ballotCard = member && ballot && !ballot.submitted && later !== ballot.drawId && (
    <div className="review-overlay" key="review">
      <ReviewBallotCard
        key={ballot.drawId}
        ballot={ballot}
        variant={variant}
        channelName={status.channelName}
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={submit}
        onLater={() => setLater(ballot.drawId)}
      />
    </div>
  );
  // Anyone holding the channel link may log in to review, or just watch.
  const join = !member && api && (reviews.enabled || status.round?.reviews) && (
    <ReviewJoin
      apiUrl={api}
      capability={capability}
      {...(variant === "beer"
        ? { explanation: "Log in om na afloop de halers te beoordelen." }
        : {})}
      viewLink={
        status.viewerCapability
          ? channelViewRoute(app, status.viewerCapability)
          : undefined
      }
    />
  );
  const viewLink = status.viewerCapability && (
    <ViewLinkButton
      app={app}
      capability={status.viewerCapability}
      setNotice={setNotice}
    />
  );
  const admin = status.role === "admin" && (
    <ChannelAdmin
      app={app}
      status={status}
      requestCapability={requestCapability}
      pending={pending}
      act={act}
      setNotice={setNotice}
    />
  );
  // A minute after the finale the page shows who fetches, until the round
  // can no longer be watched; the wheels stay one click away.
  if (status.round && over && live) {
    const spectator = status.round.spectatorCapability;
    const startAt = Date.parse(status.round.startAt);
    return (
      <ChannelTheme variant={variant} word={word}>
        {ballotCard}
        <RoundResult
          controller={live}
          badge={channelTitle(variant, status.channelName, word)}
          roundName={roundCopy(variant, word).round}
          today={variant === "beer" && today(startAt)}
          when={startLabel(startAt)}
          replayOpen={replayOf === spectator}
          onReplay={(open) => setReplayOf(open ? spectator : undefined)}
        >
          {memberBar}
          <ReviewProgressNote controller={live} />
          <p>{appCopy[app].again}</p>
          {viewLink}
          {notice && <p role="status">{notice}</p>}
          {join}
          {admin}
        </RoundResult>
      </ChannelTheme>
    );
  }
  // The fixed channel page: the latest round's live wheel, then the next request.
  if (status.round)
    return (
      <ChannelTheme variant={variant} word={word}>
        {ballotCard}
        <div className="channel-live">
          <div className="channel-strip" aria-live="polite">
            <strong>{channelTitle(variant, status.channelName, word)}</strong>
            {status.round.active ? (
              <span>
                {roundLabel(variant, word)}! Het rad draait{" "}
                {startLabel(Date.parse(status.round.startAt))}
                <ServerTimeLeft
                  controller={live}
                  startAt={Date.parse(status.round.startAt)}
                />
                . Klik op{" "}
                {themes[variant].icon} onder de oproep in Slack om mee te doen.
              </span>
            ) : (
              <span>{appCopy[app].again}</span>
            )}
            {viewLink}
            <ReviewProgressNote controller={live} />
            {notice && <small role="status">{notice}</small>}
            {memberBar}
            {join}
          </div>
          <ChannelLive key={status.round.spectatorCapability} controller={live} />
        </div>
        {admin && <div className="unavailable channel-page">{admin}</div>}
      </ChannelTheme>
    );
  return (
    <ChannelTheme variant={variant}>
      {ballotCard}
      <div className="unavailable channel-page">
        <span className="friday-badge">{channelTitle(variant, status.channelName)}</span>
        {memberBar}
        <h1>{appCopy[app].idleTitle}</h1>
        <section className="channel-request">
          <p>{appCopy[app].idle}</p>
          {status.roundsLeft === 0 && (
            <p className="helper">Vandaag zijn er genoeg rondes geweest. Morgen weer!</p>
          )}
          {viewLink}
        </section>
        {notice && <p role="status">{notice}</p>}
        {join}
        {admin}
      </div>
    </ChannelTheme>
  );
}

/** The view-only word link: the latest round's wheel, nothing to request or manage. */
export function ChannelViewPage({
  app = "coffee",
  capability,
}: {
  app?: ChannelApp;
  capability: string;
}) {
  const api = configuredApiUrl();
  const own = channelApps[app];
  const [round, setRound] = useState<ChannelRound | null>();
  const [channelName, setChannelName] = useState<string>();
  const [shown, setShown] = useState<ChannelVariant>(idleVariant(app));
  const [word, setWord] = useState<string>();
  const [gone, setGone] = useState(false);
  const live = useRoundController(api, round?.spectatorCapability);
  const over = useRoundOver(live, round?.active ?? true);
  const [replayOf, setReplayOf] = useState<string>();
  useEffect(() => {
    if (!api) return;
    let active = true;
    const refresh = () =>
      void channelRequest(api, capability).then(
        (result) => {
          if (active && result.type === "view") {
            setRound(result.round ?? null);
            setChannelName(result.channelName);
            setShown(result.round?.variant ?? result.variant ?? idleVariant(app));
            setWord(result.round?.title);
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
  }, [api, app, capability]);
  if (!api || gone)
    return (
      <ChannelTheme variant={shown}>
        <div className="unavailable channel-page">
          <h1>
            {own.icon} Dit {own.name} is niet beschikbaar.
          </h1>
          <p>
            {gone
              ? "Deze meekijklink is vervangen of de koppeling is opgeheven. Vraag de beheerder van het kanaal om de nieuwe link."
              : "Live kanaalrondes zijn hier nog niet ingesteld."}
          </p>
          <a href={own.local}>Open een lokaal {own.name}</a>
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
  if (round && over && live) {
    const startAt = Date.parse(round.startAt);
    return (
      <ChannelTheme variant={shown} word={word}>
        <RoundResult
          controller={live}
          badge={channelTitle(shown, channelName, word)}
          roundName={roundCopy(shown, word).round}
          today={shown === "beer" && today(startAt)}
          when={startLabel(startAt)}
          replayOpen={replayOf === round.spectatorCapability}
          onReplay={(open) =>
            setReplayOf(open ? round.spectatorCapability : undefined)
          }
        >
          <ReviewProgressNote controller={live} />
          <p>{appCopy[app].again}</p>
        </RoundResult>
      </ChannelTheme>
    );
  }
  if (round)
    return (
      <ChannelTheme variant={shown} word={word}>
        <div className="channel-live">
          <div className="channel-strip" aria-live="polite">
            <strong>{channelTitle(shown, channelName, word)}</strong>
            <span>
              {round.active ? (
                <>
                  {roundLabel(shown, word)}! Het rad draait{" "}
                  {startLabel(Date.parse(round.startAt))}
                  <ServerTimeLeft
                    controller={live}
                    startAt={Date.parse(round.startAt)}
                  />
                  . Klik op {themes[shown].icon} onder de oproep in Slack om
                  mee te doen.
                </>
              ) : (
                appCopy[app].again
              )}
            </span>
            <ReviewProgressNote controller={live} />
          </div>
          <ChannelLive key={round.spectatorCapability} controller={live} />
        </div>
      </ChannelTheme>
    );
  return (
    <ChannelTheme variant={shown}>
      <div className="unavailable channel-page" aria-live="polite">
        <span className="friday-badge">{channelTitle(shown, channelName)}</span>
        <h1>{appCopy[app].idleTitle}</h1>
        <p>{appCopy[app].viewIdle}</p>
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
/** How many have voted, never who: the spectator count everyone already sees. */
function ReviewProgressNote({
  controller,
}: {
  controller?: RemoteSessionController;
}) {
  const review = useSyncExternalStore(
    controller?.subscribe ?? noSubscription,
    () => controller?.getSnapshot().live?.review,
  );
  if (!review) return null;
  return (
    <small className="review-progress" aria-live="polite">
      ⭐ {review.voted} van {review.eligible} gestemd · tot{" "}
      {clock.format(Date.parse(review.closesAt))}
    </small>
  );
}
/** The live wheel of one round, as a spectator; keyed per round so it remounts. */
function ChannelLive({ controller }: { controller?: RemoteSessionController }) {
  return controller ? (
    <App controller={controller} />
  ) : (
    <p className="notice">Het rad wordt klaargezet…</p>
  );
}

/** The word link for a TV or second screen: copied, and shown to type over. */
function ViewLinkButton({
  app,
  capability,
  setNotice,
}: {
  app: ChannelApp;
  capability: string;
  setNotice: (text: string) => void;
}) {
  const link = channelViewLink(app, capability);
  return (
    <button
      className="link-button"
      onClick={() =>
        void navigator.clipboard.writeText(link).then(
          () => setNotice(`Meekijklink gekopieerd: ${link}`),
          () => setNotice(`Op een ander scherm meekijken: ${link}`),
        )
      }
    >
      🖥 Op ander scherm tonen
    </button>
  );
}

function ChannelAdmin({
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
        Bewaar deze beheerpagina zelf; deel alleen de kanaallink (het vaste rad). Een koppeling
        verloopt na 90 dagen zonder rondes (nu tot{" "}
        {new Date(status.expiresAt).toLocaleDateString("nl-NL")}).
      </p>
      {requestCapability && (
        <button
          disabled={pending}
          onClick={() =>
            void navigator.clipboard.writeText(channelLink(app, requestCapability)).then(
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
          Maak een nieuwe kanaallink om ook een meekijklink in woorden te krijgen.
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
            {Array.from({ length: MAX_BEER_WINNERS }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "bierhaler" : "bierhalers"}
              </option>
            ))}
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
            {Array.from({ length: MAX_ROUND_MINUTES }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m} {m === 1 ? "minuut" : "minuten"}
              </option>
            ))}
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
            void act({ type: "rotateRequestLink" }, "Nieuwe kanaallink gemaakt.");
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
