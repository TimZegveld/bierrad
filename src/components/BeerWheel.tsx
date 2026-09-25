import type { Participant, SpinInstruction } from "../domain/models";
import { useWheelAnimation } from "../hooks/useWheelAnimation";
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
}: {
  people: readonly Participant[];
  spin?: SpinInstruction;
  spinning: boolean;
}) {
  const ref = useWheelAnimation(spin);
  const displayed = people.length
    ? people
    : Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: "" }));
  const step = 360 / displayed.length;
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
        role="img"
        aria-label={`Bierrad met ${people.length} deelnemers`}
      >
        <circle cx="210" cy="210" r="209" fill="#292820" />
        <circle cx="210" cy="210" r="201" fill="#fff8e9" />
        {displayed.map((p, i) => {
          const a = point(i * step),
            b = point((i + 1) * step);
          return (
            <g key={p.id}>
              {displayed.length === 1 ? (
                <circle cx="210" cy="210" r="194" fill={colors[0]} />
              ) : (
                <path
                  d={`M 210 210 L ${a.join(" ")} A 194 194 0 ${step > 180 ? 1 : 0} 1 ${b.join(" ")} Z`}
                  fill={colors[i % colors.length]}
                  stroke="#fff8e9"
                  strokeWidth="2"
                />
              )}
              <g transform={`rotate(${(i + 0.5) * step} 210 210)`}>
                <text
                  x="210"
                  y="89"
                  textAnchor="middle"
                  fill="#292820"
                  fontSize={people.length > 16 ? 10 : 15}
                  fontWeight="750"
                >
                  {p.name.length > 15 ? p.name.slice(0, 14) + "…" : p.name}
                </text>
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
        🍻
      </div>
      {!people.length && (
        <div className="empty-wheel">
          Jouw vrijdagploeg
          <br />
          <strong>hoort hier thuis.</strong>
        </div>
      )}
    </div>
  );
}
