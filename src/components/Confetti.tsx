import type { CSSProperties } from "react";
import { feestTheme } from "../../shared/variant";
import { colors } from "./BeerWheel";
/** A Feestrad finale: rainbow confetti in three waves, in all shapes and speeds. */
const PARTY_PIECES = 150;
export function Confetti({ party = false }: { party?: boolean }) {
  const palette = party
    ? [...feestTheme.wheelColors!, "#ffd43b", "#ffffff"]
    : colors;
  return (
    <div className={`confetti${party ? " party" : ""}`} aria-hidden="true">
      {Array.from({ length: party ? PARTY_PIECES : 42 }, (_, i) => (
        <i
          key={i}
          style={
            {
              left: `${(i * 37) % 100}%`,
              background: palette[i % palette.length],
              animationDelay: party
                ? `${Math.floor(i / 50) * 1.1 + (i % 9) * 0.09}s`
                : `${(i % 7) * 0.11}s`,
              transform: `rotate(${i * 23}deg)`,
              ...(party
                ? {
                    width: `${6 + (i % 4) * 3}px`,
                    height: `${i % 5 === 0 ? 6 + (i % 4) * 3 : 12 + (i % 3) * 5}px`,
                    borderRadius: i % 5 === 0 ? "50%" : "2px",
                    animationDuration: `${3.2 + (i % 6) * 0.35}s`,
                    "--sway": `${((i * 53) % 160) - 80}px`,
                  }
                : {}),
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
