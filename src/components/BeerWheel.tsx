import { useTheme } from "../Theme";
import type { Participant, SpinInstruction } from "../domain/models";
import { useWheelAnimation } from "../hooks/useWheelAnimation";
import { usePointerTicks } from "../hooks/usePointerTicks";
import { idleRotation, RIM_PEGS, wheelSlices } from "../domain/spin";
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
  // Server-set weights make a slice bigger; equal slices without them.
  const weights = displayed.some((p) => (p.weight ?? 1) > 1)
    ? displayed.map((p) => p.weight ?? 1)
    : undefined;
  const slices = wheelSlices(displayed.length, weights).map((s) => ({
    from: s.start * 360,
    size: s.size * 360,
  }));
  // Matches the first spin's startRotation, so the wheel never jumps when it starts.
  const ref = useWheelAnimation(
    spin,
    idleRotation(wheelIndex, displayed.length, weights),
  );
  const pointer = usePointerTicks(ref, spinning);
  const point = (angle: number, radius = 194) => [
    210 + radius * Math.sin((angle * Math.PI) / 180),
    210 - radius * Math.cos((angle * Math.PI) / 180),
  ];
  return (
    <div className={`wheel-shell ${spinning ? "is-spinning" : ""}`}>
      <div ref={pointer} className="pointer" aria-hidden="true" />
      <svg
        ref={ref}
        viewBox="0 0 420 420"
        data-dense={people.length > 24}
        role="img"
        aria-label={`${theme.name} met ${people.length} deelnemers`}
      >
        <circle className="wheel-rim" cx="210" cy="210" r="209" />
        <circle className="wheel-face" cx="210" cy="210" r="201" />
        {displayed.map((p, i) => {
          const { from, size } = slices[i];
          const middle = from + size / 2;
          const a = point(from),
            b = point(from + size);
          return (
            <g key={p.id}>
              {displayed.length === 1 ? (
                <circle cx="210" cy="210" r="194" fill={palette[0]} />
              ) : (
                <path
                  d={`M 210 210 L ${a.join(" ")} A 194 194 0 ${size > 180 ? 1 : 0} 1 ${b.join(" ")} Z`}
                  className="wheel-segment"
                  fill={palette[i % palette.length]}
                  strokeWidth="2"
                />
              )}
              <g transform={`rotate(${middle - 90} 210 210)`}>
                <text
                  x="333"
                  y="210"
                  dominantBaseline="middle"
                  transform={
                    middle > 180 ? "rotate(180 333 210)" : undefined
                  }
                  textLength={p.name.length > 13 ? 132 : undefined}
                  lengthAdjust="spacingAndGlyphs"
                  textAnchor="middle"
                  className="wheel-name"
                  fontSize={people.length > 24 ? 14 : 19}
                  fontWeight="750"
                >
                  <title>{p.name}</title>
                  {p.name.length > 18 ? p.name.slice(0, 17) + "…" : p.name}
                </text>
              </g>
            </g>
          );
        })}
        {Array.from({ length: RIM_PEGS }, (_, i) => {
          const [x, y] = point((i * 360) / RIM_PEGS, 204);
          return <circle key={i} className="wheel-peg" cx={x} cy={y} r="2" />;
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
