import type { CSSProperties } from "react";
import { feestTheme } from "../../shared/variant";
/** Where and when each rocket bursts: [left %, top %, delay s]. */
const BURSTS: readonly [number, number, number][] = [
  [18, 26, 0.2],
  [78, 20, 0.7],
  [50, 14, 1.2],
  [30, 42, 1.8],
  [68, 38, 2.3],
  [12, 16, 2.9],
  [88, 34, 3.4],
  [44, 28, 4],
  [60, 18, 4.6],
];
const SPARKS = 18;
/**
 * A Feestrad finale: rainbow fireworks over the wheels. Display only, CSS
 * only, gone with reduced motion; it never touches the draw.
 */
export function Fireworks() {
  const palette = feestTheme.wheelColors!;
  return (
    <div className="fireworks" aria-hidden="true">
      {BURSTS.map(([left, top, delay], b) => (
        <div
          key={b}
          className="firework"
          style={
            {
              left: `${left}%`,
              top: `${top}%`,
              "--delay": `${delay}s`,
              "--color": palette[b % palette.length],
              "--color-2": palette[(b + 3) % palette.length],
            } as CSSProperties
          }
        >
          <span className="firework-rocket" />
          <span className="firework-flash" />
          {Array.from({ length: SPARKS }, (_, s) => (
            <i
              key={s}
              style={
                {
                  "--angle": `${(360 / SPARKS) * s}deg`,
                  "--reach": `${90 + ((s * 37 + b * 11) % 60)}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}
