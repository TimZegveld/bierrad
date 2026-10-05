import { useTheme } from "../Theme";
import type { Participant, SpinInstruction } from "../domain/models";
import { useWheelAnimation } from "../hooks/useWheelAnimation";
import { idleRotation } from "../domain/spin";
import { StarGlyphs } from "./RatingStars";
export const colors = [
  "#f8bd37",
  "#eb794e",
  "#79998a",
  "#f7df91",
  "#aa9ec2",
  "#d9a26c",
  "#a6bb9c",
  "#efb4a3",
];
export function BeerWheel({
  people,
  spin,
  spinning,
  wheelIndex = 0,
}: {
  people: readonly Participant[];
  spin?: SpinInstruction;
  spinning: boolean;
  wheelIndex?: number;
}) {
  const theme = useTheme();
  const palette = theme.wheelColors ?? colors;
  const displayed: readonly Participant[] = people.length
    ? people
    : Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: "" }));
  // Matches the first spin's startRotation, so the wheel never jumps when it starts.
  const ref = useWheelAnimation(
    spin,
    idleRotation(wheelIndex, displayed.length),
  );
  const step = 360 / displayed.length;
  // Keep each name + star row within the tangential space of dense segments.
  const ratedFontSize = Math.min(17, 430 / displayed.length);
  const starHeight = Math.min(12, 180 / displayed.length);
  const ratedNameY = 210 - (starHeight + 2) / 2;
  const point = (angle: number, radius = 194) => [
    210 + radius * Math.sin((angle * Math.PI) / 180),
    210 - radius * Math.cos((angle * Math.PI) / 180),
  ];
  return (
    <div className={`wheel-shell ${spinning ? "is-spinning" : ""}`}>
      <div className="pointer" aria-hidden="true" />
      <svg
        ref={ref}
        viewBox="0 0 420 420"
        data-dense={people.length > 24}
        role="img"
        aria-label={`${theme.name} met ${people.length} deelnemers`}
      >
        <circle cx="210" cy="210" r="209" fill="#292820" />
        <circle cx="210" cy="210" r="201" fill="#fff8e9" />
        {displayed.map((p, i) => {
          const a = point(i * step),
            b = point((i + 1) * step);
          return (
            <g key={p.id}>
              {displayed.length === 1 ? (
                <circle cx="210" cy="210" r="194" fill={palette[0]} />
              ) : (
                <path
                  d={`M 210 210 L ${a.join(" ")} A 194 194 0 ${step > 180 ? 1 : 0} 1 ${b.join(" ")} Z`}
                  fill={palette[i % palette.length]}
                  stroke="#fff8e9"
                  strokeWidth="2"
                />
              )}
              <g transform={`rotate(${(i + 0.5) * step - 90} 210 210)`}>
                <g
                  transform={
                    (i + 0.5) * step > 180 ? "rotate(180 333 210)" : undefined
                  }
                >
                  <text
                    x="333"
                    y={p.rating ? ratedNameY : 210}
                    dominantBaseline="middle"
                    textLength={p.name.length > 13 ? 132 : undefined}
                    lengthAdjust="spacingAndGlyphs"
                    textAnchor="middle"
                    fill="#292820"
                    fontSize={
                      p.rating ? ratedFontSize : people.length > 24 ? 14 : 19
                    }
                    fontWeight="750"
                  >
                    <title>{p.name}</title>
                    {p.name.length > 18 ? p.name.slice(0, 17) + "…" : p.name}
                  </text>
                  {p.rating && (
                    <svg
                      x="299"
                      y={ratedNameY + ratedFontSize / 2 + 1}
                      width="68"
                      height={starHeight}
                      viewBox="0 0 108 20"
                      className="wheel-rating"
                    >
                      <title>
                        {p.rating.count
                          ? `${p.rating.average.toLocaleString("nl-NL", { maximumFractionDigits: 1 })} van 5 sterren · ${p.rating.count} beoordelingen`
                          : "Nog geen beoordelingen"}
                      </title>
                      <StarGlyphs
                        value={p.rating.count ? p.rating.average : 0}
                      />
                    </svg>
                  )}
                </g>
              </g>
            </g>
          );
        })}
        {Array.from({ length: 32 }, (_, i) => {
          const [x, y] = point((i * 360) / 32, 204);
          return <circle key={i} cx={x} cy={y} r="2" fill="#f8df95" />;
        })}
      </svg>
      <div className="wheel-hub" aria-hidden="true">
        {theme.icon}
      </div>
      {!people.length && (
        <div className="empty-wheel">
          Jouw {theme.crew}
          <br />
          <strong>hoort hier thuis.</strong>
        </div>
      )}
    </div>
  );
}
