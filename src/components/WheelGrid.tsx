import { useTheme } from "../Theme";
import type { BeerWheelSession } from "../domain/models";
import { wheelCount, wheelParticipants } from "../domain/drawEngine";
import { BeerWheel } from "./BeerWheel";
import { RatingStars } from "./RatingStars";
export function WheelGrid({ session }: { session: BeerWheelSession }) {
  const theme = useTheme();
  const people = wheelParticipants(session);
  const count = wheelCount(session);
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
            aria-label={`${theme.haler} ${i + 1}`}
          >
            <h2 className="wheel-label">
              {theme.haler.toUpperCase()} {String(i + 1).padStart(2, "0")}
            </h2>
            <BeerWheel
              people={people}
              spin={spin}
              wheelIndex={i}
              spinning={session.state === "spinning" && !winner}
            />
            <div
              className={`wheel-reveal ${winner ? "revealed" : ""}`}
              aria-live="polite"
            >
              {winner ? (
                <>
                  <span>{theme.winnerIcon}</span> <strong>{winner.name}</strong>
                  {winner.rating && (
                    <RatingStars rating={winner.rating} compact />
                  )}
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
