import { useState } from "react";
import { BeerWheel } from "./components/BeerWheel";
import { ParticipantManager } from "./components/ParticipantManager";
import { WinnerAnnouncement } from "./components/WinnerAnnouncement";
import { FinalResult } from "./components/FinalResult";
import { Confetti } from "./components/Confetti";
import { useBeerWheel } from "./hooks/useBeerWheel";
import type { SessionController } from "./sessions/SessionController";
import { wheelParticipants, sessionWinners } from "./domain/drawEngine";
import type { Participant } from "./types";
export default function App({ controller }: { controller: SessionController }) {
  const {
    session,
    capabilities,
    notice: sessionNotice,
    error,
    pending,
    run,
  } = useBeerWheel(controller);
  const [uiNotice, setNotice] = useState("");
  const notice = error || sessionNotice || uiNotice;
  const winners = sessionWinners(session);
  const spinning = session.state.startsWith("spinning");
  const locked = !capabilities.canManageParticipants || pending;
  const change = (people: Participant[]) => {
    void run(() => controller.setParticipants(people));
  };
  const spin = () => {
    void run(() =>
      session.state === "ready"
        ? controller.startFirstSpin()
        : controller.startSecondSpin(),
    );
  };
  const reset = () => {
    void run(() => controller.reset());
  };
  if (!capabilities.canViewSession)
    return <p>Deze sessie is niet beschikbaar.</p>;
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
        <div className="game-layout">
          <section className="wheel-area" aria-label="De trekking">
            {session.state === "finished" ? (
              <FinalResult
                winners={winners}
                onReset={reset}
                onNew={() => {
                  void run(() => controller.newDraw());
                }}
                canReset={capabilities.canReset && !pending}
              />
            ) : (
              <>
                <div className="round-label">
                  <span className={!winners.length ? "active" : ""}>
                    01 <small>Eerste bierhaler</small>
                  </span>
                  <b>······</b>
                  <span className={winners.length ? "active" : ""}>
                    02 <small>Tweede bierhaler</small>
                  </span>
                </div>
                <BeerWheel
                  people={wheelParticipants(session)}
                  spin={session.spin}
                  spinning={spinning}
                />
                <div className="draw-controls" aria-live="polite">
                  {session.state === "first-winner" ? (
                    <WinnerAnnouncement winner={winners[0]} />
                  ) : (
                    <h2>
                      {session.state === "spinning-second"
                        ? "🍺 Wie wordt het slachtoffer nummer twee?"
                        : "🍺 Wie haalt het eerste rondje?"}
                    </h2>
                  )}
                  {capabilities.canControlSession ? (
                    <button
                      className="primary spin-button"
                      disabled={!capabilities.canStartSpin || pending}
                      onClick={spin}
                    >
                      {spinning
                        ? "Het lot is in beweging…"
                        : session.state === "first-winner"
                          ? "Draai voor nummer 2 →"
                          : "DRAAI HET BIERRAD!"}{" "}
                    </button>
                  ) : null}
                  <p className="helper">
                    {spinning
                      ? "Spanning stijgt. Dorst ook."
                      : !capabilities.canControlSession
                        ? "Kijk mee. De host bedient het rad."
                        : session.state === "setup"
                          ? "Voeg minstens 2 deelnemers toe om te draaien."
                          : session.state === "first-winner"
                            ? "De eerste winnaar doet niet mee aan de tweede draai."
                            : "Twee bierhalers. Eerlijke kansen. Koud bier."}
                  </p>
                </div>
              </>
            )}
          </section>
          <div className="sidebar">
            <ParticipantManager
              people={session.participants}
              locked={locked}
              readOnly={!capabilities.canControlSession}
              onChange={change}
              onRestore={() => {
                void run(() => controller.restoreParticipants());
              }}
            />
            <div className="how-it-works">
              <span>✦</span>
              <div>
                <strong>Het rad beslist.</strong>
                <p>
                  Voeg je collega's toe, draai twee keer en stuur de gelukkigen
                  op biermissie.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
      <footer>
        <span>Met liefde gebrouwen voor de vrijdagmiddag.</span>
        <span>
          2 bierhalers <b>·</b> 0 discussies <b>·</b> 100% toeval
        </span>
      </footer>
      {["first-winner", "finished"].includes(session.state) && (
        <Confetti key={session.state} />
      )}
    </div>
  );
}
