import { SlackControls, SlackResultStatus } from "./components/SlackControls";
import { PlaybackClock } from "./hooks/PlaybackClock";
import { useState } from "react";
import { WheelGrid } from "./components/WheelGrid";
import { WinnerCountControl } from "./components/WinnerCountControl";
import { ParticipantManager } from "./components/ParticipantManager";
import { FinalResult } from "./components/FinalResult";
import { Confetti } from "./components/Confetti";
import { useBeerWheel } from "./hooks/useBeerWheel";
import type { SessionController } from "./sessions/SessionController";
import { sessionWinners } from "./domain/drawEngine";

export default function App({ controller }: { controller: SessionController }) {
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
  const notice = error || sessionNotice || uiNotice;
  const slackBusy = !!live?.slack?.importing;
  const slackPosting =
    !!live?.slack?.result &&
    ["pending", "posting"].includes(live.slack.result.status);
  const spinning = ["countdown", "spinning"].includes(session.state);
  const finished = session.state === "finished";
  const start = () => {
    void run(() => controller.startDraw());
  };
  if (!capabilities.canViewSession)
    return (
      <div className="unavailable">
        <h1>🍻 Dit Bierrad is afgelopen.</h1>
        <p>De link is verlopen of niet beschikbaar.</p>
        <a href="./">Terug naar je eigen Bierrad</a>
      </div>
    );
  return (
    <div className="app">
      <header>
        <a className="brand" href="./">
          🍻{" "}
          <strong>
            bierrad<span>®</span>
          </strong>
        </a>
        <span className="friday-badge">
          <i /> Vrijdag begint hier
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
      <main>
        <div className="intro">
          <span className="eyebrow">GEEN DISCUSSIE. GEWOON DRAAIEN.</span>
          <h1>🍻 Bierrad 🎡</h1>
          <p>Wie haalt deze week het bier?</p>
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
              disabled={!capabilities.canConfigureDraw || pending || slackBusy}
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
                  slackBusy ||
                  slackPosting
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
                      slackBusy ||
                      slackPosting
                    }
                    onClick={start}
                  >
                    {session.state === "countdown"
                      ? "Iedereen klaar? Daar gaan we…"
                      : spinning
                        ? "Het lot is in beweging…"
                        : "🍻 DRAAI HET BIERRAD!"}
                  </button>
                )}
                <p className="helper">
                  {spinning
                    ? "Alle raderen draaien. De spanning stijgt."
                    : !capabilities.canControlSession
                      ? "Kijk mee. De host bedient het rad."
                      : !session.participants.length
                        ? "Voeg minstens één deelnemer toe om te draaien."
                        : `${session.winnerCount} ${session.winnerCount === 1 ? "bierhaler" : "unieke bierhalers"}. Eén druk op de knop.`}
                </p>
              </div>
            )}
            {live?.role === "host" && live.slack && (
              <SlackResultStatus
                status={live.slack}
                disabled={pending || live.status !== "connected"}
                onRetry={() => {
                  void run(() => controller.retrySlackResult!());
                }}
              />
            )}
          </section>
          <div className="sidebar">
            <ParticipantManager
              live={!!live}
              sourceControls={
                live?.role === "host" &&
                live.slack &&
                controller.importSlack ? (
                  <SlackControls
                    status={live.slack}
                    locked={!capabilities.canManageParticipants || pending}
                    onImport={(link) => controller.importSlack!(link)}
                    onManual={() => controller.useManualSource!()}
                  />
                ) : undefined
              }
              people={session.participants}
              locked={
                !capabilities.canManageParticipants || pending || slackBusy
              }
              readOnly={!capabilities.canControlSession}
              onChange={(people) => {
                void run(() => controller.setParticipants(people));
              }}
              onRestore={() => {
                void run(() => controller.restoreParticipants());
              }}
            />
            <div className="how-it-works">
              <span>✦</span>
              <div>
                <strong>Het rad beslist.</strong>
                <p>
                  Kies je bierbrigade. Alle raderen draaien tegelijk, ieder met
                  een andere gelukkige.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <footer>
        <span>Met liefde gebrouwen voor de vrijdagmiddag.</span>
        <span>
          {session.winnerCount}{" "}
          {session.winnerCount === 1 ? "bierhaler" : "bierhalers"} <b>·</b> 0
          discussies <b>·</b> 100% toeval
        </span>
      </footer>
      {finished && <Confetti key={session.activeDraw?.id} />}
    </div>
  );
}
