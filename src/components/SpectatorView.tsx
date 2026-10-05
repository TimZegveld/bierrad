import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTheme } from "../Theme";
import { localHash } from "../../shared/variant";
import type { BeerWheelSession } from "../domain/models";
import type { LiveInfo } from "../sessions/SessionController";
import { sessionWinners, wheelCount } from "../domain/drawEngine";
import {
  bestWheelColumns,
  countLabel,
  spectatorPresentation,
  wheelColumns,
} from "../domain/presentation";
import { formatScheduledTime } from "../utils/schedule";
import { PlaybackClock } from "../hooks/PlaybackClock";
import { WheelGrid } from "./WheelGrid";
import { DrawCountdown } from "./DrawCountdown";
import { TimeLeft } from "./TimeLeft";
import { ParticipantDrawer } from "./ParticipantDrawer";
import { SpectatorResult } from "./SpectatorResult";
import { Confetti } from "./Confetti";
import { RatingPrompt } from "./RatingPrompt";
/** Only celebrate when the reveal was actually watched, not on a later reload. */
const CELEBRATION_WINDOW_MS = 15000;
/** Read-only presentation for screens and office TVs; never issues commands. */
export function SpectatorView({
  session,
  live,
  clockOffsetMs,
  notice,
  onBeginRating,
}: {
  session: BeerWheelSession;
  live: LiveInfo;
  clockOffsetMs?: number;
  notice: string;
  onBeginRating?: (drawId: string) => void;
}) {
  const theme = useTheme();
  const offset = clockOffsetMs ?? 0;
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const now = Date.now() + offset;
  const view = spectatorPresentation(session, live.scheduledDraw, now);
  // Re-render only at phase boundaries; the countdown ticks inside its own component.
  useEffect(() => {
    if (view.nextChangeAt === undefined) return;
    const wait = Math.min(view.nextChangeAt - now + 25, 60000);
    const timer = window.setTimeout(tick, Math.max(0, wait));
    return () => window.clearTimeout(timer);
  }, [now, view.nextChangeAt]);
  const count = wheelCount(session);
  const stage = useRef<HTMLElement>(null);
  const [columns, setColumns] = useState(() => wheelColumns(count));
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const gap = Math.min(56, Math.max(18, window.innerWidth * 0.03));
      setColumns(
        bestWheelColumns(count, element.clientWidth, element.clientHeight, gap),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [count]);
  const show = view.phase === "countdown" || view.phase === "spinning";
  const compact = show || view.phase === "result";
  const draw = session.activeDraw;
  const celebrate =
    view.phase === "result" &&
    !!draw &&
    now <
      Date.parse(draw.startAt) +
        Math.max(...draw.spins.map((spin) => spin.durationMs)) +
        CELEBRATION_WINDOW_MS;
  return (
    <div
      className={`spectator${show ? " show-mode" : ""}${compact ? " compact" : ""}`}
      data-phase={view.phase}
    >
      <SpectatorHeader status={live.status} />
      <div className="spectator-intro">
        <h1>{theme.name}</h1>
        <p>{theme.question}</p>
        {view.phase !== "empty" && (
          <p className="spectator-summary">
            {countLabel(session.winnerCount, theme.haler, `${theme.haler}s`)} ·{" "}
            {countLabel(session.participants.length, "deelnemer", "deelnemers")}
          </p>
        )}
        {!show && session.participants.length > 0 && (
          <ParticipantDrawer people={session.participants} />
        )}
      </div>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <main
        ref={stage}
        className="spectator-stage"
        aria-label="De trekking"
        style={
          {
            "--wide-cols": columns,
            "--wide-rows": Math.ceil(count / columns),
          } as CSSProperties
        }
      >
        <PlaybackClock.Provider value={offset}>
          <WheelGrid session={session} />
        </PlaybackClock.Provider>
        {view.phase === "countdown" && view.startAt !== undefined && (
          <DrawCountdown startAt={view.startAt} offsetMs={offset} />
        )}
      </main>
      <div className="spectator-status" aria-live="polite">
        {view.phase === "result" ? (
          <SpectatorResult winners={sessionWinners(session)} />
        ) : view.phase === "empty" ? (
          <>
            {view.skipped ? (
              <p>De automatische trekking ging niet door.</p>
            ) : (
              <p>
                {theme.icon} De {theme.crew} wordt nog samengesteld…
              </p>
            )}
            {live.scheduledDraw?.status === "pending" && (
              <p className="spectator-schedule">
                ⏰ Automatische trekking{" "}
                {formatScheduledTime(live.scheduledDraw.startAt)}
                <TimeLeft
                  startAt={Date.parse(live.scheduledDraw.startAt)}
                  offsetMs={offset}
                />
              </p>
            )}
          </>
        ) : view.phase === "waiting" ? (
          <>
            {view.skipped && <p>De automatische trekking ging niet door.</p>}
            {view.startAt !== undefined ? (
              <p className="spectator-schedule">
                ⏰ Automatische trekking{" "}
                {formatScheduledTime(new Date(view.startAt).toISOString())}
                <TimeLeft startAt={view.startAt} offsetMs={offset} />
              </p>
            ) : (
              <p>Wachten tot het rad gaat draaien…</p>
            )}
          </>
        ) : null}
      </div>
      {celebrate && <Confetti key={draw.id} />}
      {live.ratings && onBeginRating && (
        <RatingPrompt
          status={live.ratings}
          offset={offset}
          connected={live.status === "connected"}
          drawing={show}
          onBegin={onBeginRating}
        />
      )}
    </div>
  );
}
function SpectatorHeader({ status }: { status: LiveInfo["status"] }) {
  const theme = useTheme();
  const [notice, setNotice] = useState("");
  const trouble =
    status === "reconnecting"
      ? "Verbinding kwijt… We proberen opnieuw te verbinden."
      : status === "connecting"
        ? "Verbinden…"
        : "";
  return (
    <div className="spectator-bar">
      <span className={`live-indicator ${status}`}>
        <i aria-hidden="true" /> LIVE
      </span>
      <span className="spectator-bar-label">Je kijkt mee</span>
      {trouble && (
        <strong className="connection-trouble" role="status">
          {trouble}
        </strong>
      )}
      {notice && <small role="status">{notice}</small>}
      <button
        className="fullscreen"
        onClick={() => {
          const action = document.fullscreenElement
            ? document.exitFullscreen()
            : document.documentElement.requestFullscreen?.();
          action?.catch(() =>
            setNotice("Volledig scherm is niet beschikbaar in deze browser."),
          );
        }}
        aria-label="Volledig scherm"
      >
        ⛶
      </button>
      <a href={localHash(theme.variant)}>Eigen {theme.name}</a>
    </div>
  );
}
