import { useEffect, useState } from "react";
import { BeerWheel } from "./components/BeerWheel";
import { ParticipantManager } from "./components/ParticipantManager";
import { WinnerAnnouncement } from "./components/WinnerAnnouncement";
import { FinalResult } from "./components/FinalResult";
import { Confetti } from "./components/Confetti";
import { useBeerWheel } from "./hooks/useBeerWheel";
import { ManualParticipantSource } from "./services/ManualParticipantSource";
import type { Participant } from "./types";
const source = new ManualParticipantSource();
export default function App() {
  const { draw, setParticipants, spin, finish, reset } = useBeerWheel();
  const [notice, setNotice] = useState("");
  const [loaded, setLoaded] = useState(false);
  async function restore() {
    try {
      setParticipants(await source.getParticipants());
      setNotice("");
    } catch {
      setNotice(
        "De opgeslagen lijst is niet beschikbaar. Je kunt gewoon handmatig deelnemers toevoegen.",
      );
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    void restore();
  }, []);
  function change(people: Participant[]) {
    setParticipants(people);
    try {
      if (people.length) source.save(people);
      setNotice("");
    } catch {
      setNotice(
        "Opslaan is niet beschikbaar. Deze ronde werkt wel; de lijst blijft alleen in dit venster.",
      );
    }
  }
  const spinning = draw.state.startsWith("spinning");
  const locked = !["setup", "ready"].includes(draw.state) || !loaded;
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
            {draw.state === "finished" ? (
              <FinalResult
                winners={draw.winners}
                onReset={reset}
                onNew={() => change([])}
              />
            ) : (
              <>
                <div className="round-label">
                  <span className={!draw.winners.length ? "active" : ""}>
                    01 <small>Eerste bierhaler</small>
                  </span>
                  <b>······</b>
                  <span className={draw.winners.length ? "active" : ""}>
                    02 <small>Tweede bierhaler</small>
                  </span>
                </div>
                <BeerWheel
                  people={draw.wheel}
                  pending={draw.pending}
                  spinning={spinning}
                  onFinish={finish}
                />
                <div className="draw-controls" aria-live="polite">
                  {draw.state === "first-winner" ? (
                    <WinnerAnnouncement winner={draw.winners[0]} />
                  ) : (
                    <h2>
                      {draw.state === "spinning-second"
                        ? "🍺 Wie wordt het slachtoffer nummer twee?"
                        : "🍺 Wie haalt het eerste rondje?"}
                    </h2>
                  )}
                  <button
                    className="primary spin-button"
                    disabled={spinning || draw.state === "setup" || !loaded}
                    onClick={spin}
                  >
                    {spinning
                      ? "Het lot is in beweging…"
                      : draw.state === "first-winner"
                        ? "Draai voor nummer 2 →"
                        : "DRAAI HET BIERRAD!"}{" "}
                  </button>
                  <p className="helper">
                    {spinning
                      ? "Spanning stijgt. Dorst ook."
                      : draw.state === "setup"
                        ? "Voeg minstens 2 deelnemers toe om te draaien."
                        : draw.state === "first-winner"
                          ? "De eerste winnaar doet niet mee aan de tweede draai."
                          : "Twee bierhalers. Eerlijke kansen. Koud bier."}
                  </p>
                </div>
              </>
            )}
          </section>
          <div className="sidebar">
            <ParticipantManager
              people={draw.original}
              locked={locked}
              onChange={change}
              onRestore={() => void restore()}
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
      {["first-winner", "finished"].includes(draw.state) && (
        <Confetti key={draw.state} />
      )}
    </div>
  );
}
