import type { BeerWheelSession } from "../domain/models";
import { wheelParticipants } from "../domain/drawEngine";
import { BeerWheel } from "./BeerWheel";
export function WheelGrid({ session }: { session: BeerWheelSession }) {
  const people = wheelParticipants(session);
  // Empty setup shows a placeholder instead of an unbounded saved preference.
  const count =
    session.activeDraw?.spins.length ??
    (people.length ? session.winnerCount : 1);
  return (
    <div className="wheel-grid" data-count={count}>
      {Array.from({ length: count }, (_, i) => {
        const spin = session.activeDraw?.spins[i];
        const winner =
          spin && session.winnerIds.includes(spin.winnerId)
            ? people.find((p) => p.id === spin.winnerId)
            : undefined;
        return (
          <section
            className="wheel-tile"
            key={i}
            aria-label={`Bierhaler ${i + 1}`}
          >
            <h2 className="wheel-label">
              BIERHALER {String(i + 1).padStart(2, "0")}
            </h2>
            <BeerWheel
              people={people}
              spin={spin}
              spinning={session.state === "spinning" && !winner}
            />
            <div
              className={`wheel-reveal ${winner ? "revealed" : ""}`}
              aria-live="polite"
            >
              {winner ? (
                <>
                  <span>🍺</span> <strong>{winner.name}</strong>
                </>
              ) : (
                <span>
                  {session.state === "spinning"
                    ? "Wie wordt het…"
                    : "Het lot beslist."}
                </span>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
