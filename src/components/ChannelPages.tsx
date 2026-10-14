import { ChannelAdmin } from "./ChannelAdmin";
import { ChannelTheme } from "./ChannelTheme";
import { idleVariant } from "./ChannelLoginPages";
export { ChannelBindPage, ChannelMemberFailurePage } from "./ChannelLoginPages";
import { useChannelPolling } from "../hooks/useChannelPolling";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  channelApps,
  bierfeestCopy,
  feestCopy,
  isGoalVariant,
  roundCopy,
  type ChannelApp,
  type ChannelCommand,
  type ChannelRound,
  type ChannelStatus,
  type ChannelVariant,
  type RoundGoal,
} from "../../shared/channel";
import { themeFor, themes } from "../../shared/variant";
import { DEFAULT_REVIEW_SETTINGS } from "../../shared/reviews";
import type { SessionController } from "../sessions/SessionController";
import {
  ChannelApiError,
  channelRequest,
  channelViewLink,
  channelViewRoute,
} from "../sessions/ChannelClient";
import {
  ReviewBallotCard,
  ReviewJoin,
  ReviewThanks,
  type ReviewDraft,
} from "./ReviewBallot";
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
    again:
      "Typ /koffierad, /waterrad of /koekrad in het kanaal voor een nieuwe ronde.",
    idle: (
      <>
        Typ <code>/koffierad</code>, <code>/waterrad</code> of{" "}
        <code>/koekrad</code> in het Slack-kanaal, bijvoorbeeld{" "}
        <code>/waterrad 10</code> voor tien minuten of{" "}
        <code>/koekrad taart 10</code> voor een taartronde. Wie op ☕, 💧 of 🍪
        onder de oproep klikt, doet mee. Na de wachttijd draait het rad hier
        vanzelf en kiest het één haler. Typ je een tweede commando terwijl de
        ronde nog wacht, dan haakt dat rad aan en wordt het een 🌈 Feestrad: één
        haler per doel, en niemand hoeft er twee te halen.
      </>
    ),
    viewIdle: (
      <>
        Typ <code>/koffierad</code>, <code>/waterrad</code> of{" "}
        <code>/koekrad</code> in het Slack-kanaal. Zodra er een ronde is, draait
        het rad hier vanzelf.
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
const feest = (goals?: readonly RoundGoal[]) => (goals?.length ?? 0) > 1;
/** The name arrives with the first slash command; until then, no name. */
function channelTitle(
  variant: ChannelVariant,
  name?: string,
  word?: string,
  goals?: readonly RoundGoal[],
  bierfeest?: boolean,
) {
  const { icon, name: wheel } = feest(goals)
    ? feestCopy
    : bierfeest && variant === "beer"
      ? bierfeestCopy
      : themeFor(variant, word);
  return name
    ? `${icon} ${wheel} van #${name}`
    : `${icon} ${wheel} van dit kanaal`;
}
/** "☕ koffie · 💧 water": every goal of a Feestrad. */
function goalList(goals: readonly RoundGoal[]) {
  return goals
    .map((g) => {
      const theme = themeFor(g.variant, g.title);
      return `${theme.icon} ${theme.drink}`;
    })
    .join(" · ");
}
/** How to join the running round in Slack. */
function joinHint(variant: ChannelVariant, goals?: readonly RoundGoal[]) {
  return goals && feest(goals)
    ? `Klik onder de oproep in Slack op wat je wilt halen: ${goalList(goals)}.`
    : `Klik op ${themes[variant].icon} onder de oproep in Slack om mee te doen.`;
}
/**
 * The goals of the shown round: live from its session, else from the channel
 * status. A round with one goal has one; no round, none. Display only.
 */
function useRoundGoals(
  controller: SessionController | undefined,
  round: ChannelRound | null | undefined,
): readonly RoundGoal[] | undefined {
  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noSubscription,
    () => controller?.getSnapshot(),
  );
  const fromSession = snapshot?.session.goals;
  const fromStatus = round?.goals;
  const own: RoundGoal[] | undefined =
    round && isGoalVariant(round.variant ?? "coffee")
      ? [
          {
            variant: (round.variant ?? "coffee") as RoundGoal["variant"],
            ...(round.title ? { title: round.title } : {}),
          },
        ]
      : undefined;
  // Whichever source already knows the most goals: goals only ever join.
  const best =
    fromSession && fromSession.length >= (fromStatus?.length ?? 0)
      ? fromSession
      : (fromStatus ?? own);
  const key = round
    ? (best ?? [])
        .filter((g) => isGoalVariant(g.variant))
        .map((g) => `${g.variant}:${g.title ?? ""}`)
        .join(",")
    : "";
  return useMemo(
    () =>
      key
        ? key.split(",").map((part) => {
            const [variant, title] = part.split(":");
            return {
              variant: variant as RoundGoal["variant"],
              ...(title ? { title } : {}),
            };
          })
        : undefined,
    [key],
  );
}
/**
 * Whether the shown round is a Bierfeest, as its server says; undefined until
 * the first snapshot arrived, so a page opened mid-feest shows no growth.
 */
function useBierfeest(controller: SessionController | undefined) {
  return useSyncExternalStore(controller?.subscribe ?? noSubscription, () => {
    const live = controller?.getSnapshot().live;
    return live?.expiresAt ? live.bierfeest === true : undefined;
  });
}
function roundLabel(
  variant: ChannelVariant,
  word?: string,
  goals?: readonly RoundGoal[],
  bierfeest?: boolean,
) {
  const round = feest(goals)
    ? feestCopy.round
    : bierfeest && variant === "beer"
      ? bierfeestCopy.name
      : roundCopy(variant, word).round;
  return `${round[0].toUpperCase()}${round.slice(1)}`;
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
  const goals = useRoundGoals(live, status?.round);
  const bierfeest = useBierfeest(live);
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
  const receiveStatus = useCallback(
    (result: import("../../shared/channel").ChannelCommandResult) => {
      if (result.type === "status") setStatus(result.status);
    },
    [],
  );
  const polling = useChannelPolling(api, capability, receiveStatus, !gone);
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
  if (!api || gone || polling.gone)
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
              : gone || polling.gone
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
          <p className="notice">
            {notice || polling.error || "Het rad wordt gezet…"}
          </p>
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
            : feest(goals)
              ? "Klik in Slack op wat je wilt halen"
              : `Klik ${themes[variant].icon} in Slack om mee te doen`}
        </span>
      )}
      {ballot?.submitted && <ReviewThanks closesAt={ballot.closesAt} />}
      {ballot && !ballot.submitted && later === ballot.drawId && (
        <button className="primary" onClick={() => setLater(undefined)}>
          ⭐ Beoordeel{" "}
          {variant === "beer" || feest(goals) ? "de halers" : "de haler"}
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
  const ballotCard = member &&
    ballot &&
    !ballot.submitted &&
    later !== ballot.drawId && (
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
      {...(variant === "beer" || feest(goals)
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
      <ChannelTheme
        variant={variant}
        word={word}
        goals={goals}
        bierfeest={bierfeest}
      >
        {ballotCard}
        <RoundResult
          controller={live}
          badge={channelTitle(
            variant,
            status.channelName,
            word,
            goals,
            bierfeest,
          )}
          roundName={roundLabel(variant, word, goals).toLowerCase()}
          today={variant === "beer" && today(startAt)}
          when={startLabel(startAt)}
          replayOpen={replayOf === spectator}
          onReplay={(open) => setReplayOf(open ? spectator : undefined)}
        >
          {memberBar}
          <ReviewProgressNote controller={live} />
          <p>{appCopy[app].again}</p>
          {viewLink}
          {(notice || polling.error) && (
            <p role="status">{notice || polling.error}</p>
          )}
          {join}
          {admin}
        </RoundResult>
      </ChannelTheme>
    );
  }
  // The fixed channel page: the latest round's live wheel, then the next request.
  if (status.round)
    return (
      <ChannelTheme
        variant={variant}
        word={word}
        goals={goals}
        bierfeest={bierfeest}
      >
        {ballotCard}
        <div className="channel-live">
          <div className="channel-strip" aria-live="polite">
            <strong>
              {channelTitle(
                variant,
                status.channelName,
                word,
                goals,
                bierfeest,
              )}
            </strong>
            {status.round.active ? (
              <span>
                {roundLabel(variant, word, goals, bierfeest)}! Het rad draait{" "}
                {startLabel(Date.parse(status.round.startAt))}
                <ServerTimeLeft
                  controller={live}
                  startAt={Date.parse(status.round.startAt)}
                />
                . {joinHint(variant, goals)}
              </span>
            ) : (
              <span>{appCopy[app].again}</span>
            )}
            {viewLink}
            <ReviewProgressNote controller={live} />
            {(notice || polling.error) && (
              <small role="status">{notice || polling.error}</small>
            )}
            {memberBar}
            {join}
          </div>
          <ChannelLive
            key={status.round.spectatorCapability}
            controller={live}
          />
        </div>
        {admin && <div className="unavailable channel-page">{admin}</div>}
      </ChannelTheme>
    );
  return (
    <ChannelTheme variant={variant}>
      {ballotCard}
      <div className="unavailable channel-page">
        <span className="friday-badge">
          {channelTitle(variant, status.channelName)}
        </span>
        {memberBar}
        <h1>{appCopy[app].idleTitle}</h1>
        <section className="channel-request">
          <p>{appCopy[app].idle}</p>
          {status.roundsLeft === 0 && (
            <p className="helper">
              Vandaag zijn er genoeg rondes geweest. Morgen weer!
            </p>
          )}
          {viewLink}
        </section>
        {(notice || polling.error) && (
          <p role="status">{notice || polling.error}</p>
        )}
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
  const live = useRoundController(api, round?.spectatorCapability);
  const over = useRoundOver(live, round?.active ?? true);
  const goals = useRoundGoals(live, round);
  const bierfeest = useBierfeest(live);
  const [replayOf, setReplayOf] = useState<string>();
  const receiveView = useCallback(
    (result: import("../../shared/channel").ChannelCommandResult) => {
      if (result.type !== "view") return;
      setRound(result.round ?? null);
      setChannelName(result.channelName);
      setShown(result.round?.variant ?? result.variant ?? idleVariant(app));
      setWord(result.round?.title);
    },
    [app],
  );
  const polling = useChannelPolling(api, capability, receiveView);
  const gone = polling.gone;
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
          <p className="notice" role="status">
            {polling.error || "Het rad wordt gezet…"}
          </p>
        </div>
      </ChannelTheme>
    );
  if (round && over && live) {
    const startAt = Date.parse(round.startAt);
    return (
      <ChannelTheme
        variant={shown}
        word={word}
        goals={goals}
        bierfeest={bierfeest}
      >
        <RoundResult
          controller={live}
          badge={channelTitle(shown, channelName, word, goals, bierfeest)}
          roundName={roundLabel(shown, word, goals).toLowerCase()}
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
      <ChannelTheme
        variant={shown}
        word={word}
        goals={goals}
        bierfeest={bierfeest}
      >
        <div className="channel-live">
          <div className="channel-strip" aria-live="polite">
            <strong>
              {channelTitle(shown, channelName, word, goals, bierfeest)}
            </strong>
            <span>
              {round.active ? (
                <>
                  {roundLabel(shown, word, goals, bierfeest)}! Het rad draait{" "}
                  {startLabel(Date.parse(round.startAt))}
                  <ServerTimeLeft
                    controller={live}
                    startAt={Date.parse(round.startAt)}
                  />
                  . {joinHint(shown, goals)}
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
