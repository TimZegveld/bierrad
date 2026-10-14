import { useTheme } from "../Theme";
import type { BeerWheelSession } from "../domain/models";
import { wheelCount, wheelParticipants } from "../domain/drawEngine";
import { themeFor } from "../../shared/variant";
import { BeerWheel } from "./BeerWheel";
export function WheelGrid({ session }: { session: BeerWheelSession }) {
  const theme = useTheme();
  const count = wheelCount(session);
  return (
    <div className="wheel-grid" data-count={count}>
      {Array.from({ length: count }, (_, i) => {
        const people = wheelParticipants(session, i);
        const spin = session.activeDraw?.spins.find((s) => s.wheelIndex === i);
        const winner =
          spin && session.winnerIds.includes(spin.winnerId)
            ? people.find((p) => p.id === spin.winnerId)
            : undefined;
        // A Feestrad labels each wheel with its own goal.
        const goal = session.goals?.[i];
        const own = goal ? themeFor(goal.variant, goal.title) : undefined;
        const haler = own ? `${own.drink}haler` : theme.haler;
        // A goal nobody was left for does not turn.
        const empty = !!session.activeDraw && !spin;
        return (
          <section
            className="wheel-tile"
            key={i}
            aria-label={goal ? haler : `${theme.haler} ${i + 1}`}
          >
            <h2 className="wheel-label">
              {own
                ? `${own.icon} ${haler.toUpperCase()}`
                : `${theme.haler.toUpperCase()} ${String(i + 1).padStart(2, "0")}`}
            </h2>
            <BeerWheel
              people={people}
              spin={spin}
              wheelIndex={i}
              {...(own ? { own: { icon: own.icon, crew: own.crew } } : {})}
              spinning={session.state === "spinning" && !!spin && !winner}
            />
            <div
              className={`wheel-reveal ${winner ? "revealed" : ""}`}
              aria-live="polite"
            >
              {winner ? (
                <>
                  <span>{own?.winnerIcon ?? theme.winnerIcon}</span>{" "}
                  <strong>{winner.name}</strong>
                </>
              ) : (
                <span>
                  {empty
                    ? "Niemand meer over."
                    : session.state === "spinning"
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
