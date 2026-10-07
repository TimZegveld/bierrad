import { useTheme } from "./Theme";
import { localHash, standaloneVariants, themes } from "../shared/variant";
import { ScheduleControls } from "./components/ScheduleControls";
import { formatScheduledTime } from "./utils/schedule";
import { PlaybackClock } from "./hooks/PlaybackClock";
import { useCallback, useState } from "react";
import { WheelGrid } from "./components/WheelGrid";
import { WinnerCountControl } from "./components/WinnerCountControl";
import { ParticipantManager } from "./components/ParticipantManager";
import { FinalResult } from "./components/FinalResult";
import { Confetti } from "./components/Confetti";
import { SecretPanel } from "./components/SecretPanel";
import { SpectatorView } from "./components/SpectatorView";
import { useBeerWheel } from "./hooks/useBeerWheel";
import type { SessionController } from "./sessions/SessionController";
import { sessionWinners } from "./domain/drawEngine";

export default function App({ controller }: { controller: SessionController }) {
  const theme = useTheme();
  const {
    session,
    live,
    clockOffsetMs,
    capabilities,
    notice: sessionNotice,
    error,
    pending,
    run,
  } = useBeerWheel(controller);
  const [uiNotice, setNotice] = useState("");
  const [secretOpen, setSecretOpen] = useState(false);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [forcedIds, setForcedIds] = useState<string[]>([]);
  const closeSecret = useCallback(() => setSecretOpen(false), []);
  const notice = error || sessionNotice || uiNotice;
  const scheduleBusy = live?.scheduledDraw?.status === "refreshing";
  const spinning = ["countdown", "spinning"].includes(session.state);
  const finished = session.state === "finished";
  // Live draws are chosen by the server, so the secret panel is local-only.
  const canRig = !live && capabilities.canControlSession;
  const start = () => {
    void run(async () => {
      await controller.startDraw(canRig ? { weights, forcedIds } : undefined);
      setForcedIds([]);
    });
  };
  if (!capabilities.canViewSession)
    return (
      <div className="unavailable">
        <h1>
          {theme.icon} Dit {theme.name} is afgelopen.
        </h1>
        <p>De link is verlopen of niet beschikbaar.</p>
        <a href={localHash(theme.variant)}>Terug naar je eigen {theme.name}</a>
      </div>
    );
  if (live?.role === "spectator")
    return (
      <SpectatorView
        session={session}
        live={live}
        clockOffsetMs={clockOffsetMs}
        notice={notice}
      />
    );
  return (
    <div className="app">
      <header>
        <a className="brand" href={localHash(theme.variant)}>
          {theme.icon}{" "}
          <strong>
            {theme.name.toLowerCase()}
            <span>®</span>
          </strong>
        </a>
        <span className="friday-badge">
          <i /> {theme.badge}
        </span>
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
      </header>
      {!live && (
        <nav className="variant-switch" aria-label="Kies je rad">
          {standaloneVariants.map((variant) => (
            <a
              key={variant}
              href={localHash(variant)}
              aria-current={theme.variant === variant ? "page" : undefined}
              onClick={(event) => {
                if (spinning) event.preventDefault();
              }}
              aria-disabled={spinning}
            >
              {themes[variant].icon} {themes[variant].name}
            </a>
          ))}
        </nav>
      )}
      <main>
        <div className="intro">
          <span className="eyebrow">GEEN DISCUSSIE. GEWOON DRAAIEN.</span>
          <h1
            onClick={(event) => {
              if (canRig && event.detail === 3) setSecretOpen(true);
            }}
          >
            {theme.icon} {theme.name} 🎡
          </h1>
          <p>{theme.question}</p>
        </div>
        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        <div
          className={`game-layout ${session.winnerCount > 1 && session.participants.length ? "multi-wheel" : "single-wheel"} ${spinning ? "draw-in-progress" : ""}`}
        >
          <section className="wheel-area" aria-label="De trekking">
            <WinnerCountControl
              count={session.winnerCount}
              max={session.participants.length}
              disabled={!capabilities.canConfigureDraw || pending || scheduleBusy}
              readOnly={!capabilities.canControlSession}
              onChange={(count) => {
                void run(() => controller.setWinnerCount(count));
              }}
            />
            <PlaybackClock.Provider value={clockOffsetMs ?? 0}>
              <WheelGrid session={session} />
            </PlaybackClock.Provider>
            {finished ? (
              <FinalResult
                winners={sessionWinners(session)}
                onAgain={start}
                onSetup={() => {
                  void run(() => controller.reset());
                }}
                canControl={capabilities.canControlSession}
                disabled={
                  !capabilities.canStartDraw ||
                  pending ||
                  scheduleBusy
                }
              />
            ) : (
              <div className="draw-controls" aria-live="polite">
                {capabilities.canControlSession && (
                  <button
                    className="primary spin-button"
                    disabled={
                      !capabilities.canStartDraw ||
                      pending ||
                      scheduleBusy
                    }
                    onClick={start}
                  >
                    {session.state === "countdown"
                      ? "Iedereen klaar? Daar gaan we…"
                      : spinning
                        ? "Het lot is in beweging…"
                        : `${theme.icon} DRAAI HET ${theme.name.toUpperCase()}!`}
                  </button>
                )}
                <p className="helper">
                  {spinning
                    ? "Alle raderen draaien. De spanning stijgt."
                    : !capabilities.canControlSession
                      ? "Kijk mee. De host bedient het rad."
                      : !session.participants.length
                        ? "Voeg minstens één deelnemer toe om te draaien."
                        : `${session.winnerCount} ${session.winnerCount === 1 ? theme.haler : `unieke ${theme.haler}s`}. Eén druk op de knop.`}
                </p>
              </div>
            )}
            {live?.scheduledDraw?.status === "pending" && (
              <p className="helper" role="status">
                ⏰ Start automatisch{" "}
                {formatScheduledTime(live.scheduledDraw.startAt)} (Nederlandse
                tijd).
              </p>
            )}
          </section>
          <div className="sidebar">
            <ParticipantManager
              live={!!live}
              people={session.participants}
              locked={
                !capabilities.canManageParticipants || pending || scheduleBusy
              }
              readOnly={!capabilities.canControlSession}
              onChange={(people) => {
                void run(() => controller.setParticipants(people));
              }}
              onRestore={() => {
                void run(() => controller.restoreParticipants());
              }}
            />
            {live?.role === "host" &&
              live.expiresAt &&
              controller.setScheduledDraw && (
                <ScheduleControls
                  plan={live.scheduledDraw}
                  expiresAt={live.expiresAt}
                  locked={
                    !capabilities.canManageParticipants || pending || scheduleBusy
                  }
                  clockOffsetMs={clockOffsetMs}
                  onSave={(at) => controller.setScheduledDraw!(at)}
                />
              )}
            <div className="how-it-works">
              <span>✦</span>
              <div>
                <strong>Het rad beslist.</strong>
                <p>
                  Kies je {theme.brigade}. Alle raderen draaien tegelijk, ieder
                  met een andere gelukkige.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <footer>
        <span>{theme.footer}</span>
        <span>
          {session.winnerCount}{" "}
          {session.winnerCount === 1 ? theme.haler : `${theme.haler}s`} <b>·</b>{" "}
          0 discussies <b>·</b> 100% toeval
        </span>
      </footer>
      {finished && <Confetti key={session.activeDraw?.id} />}
      {secretOpen && canRig && (
        <SecretPanel
          people={session.participants}
          weights={weights}
          forcedIds={forcedIds}
          onWeight={(id, weight) => {
            const next = { ...weights };
            if (weight === 1) delete next[id];
            else next[id] = weight;
            setWeights(next);
          }}
          onForced={(id, forced) =>
            setForcedIds((ids) =>
              forced ? [...ids, id] : ids.filter((other) => other !== id),
            )
          }
          onClose={closeSecret}
        />
      )}
    </div>
  );
}
