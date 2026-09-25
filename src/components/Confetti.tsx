import { colors } from "./BeerWheel";
export function Confetti() {
  return (
    <div className="confetti" aria-hidden="true">
      {Array.from({ length: 42 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            background: colors[i % colors.length],
            animationDelay: `${(i % 7) * 0.11}s`,
            transform: `rotate(${i * 23}deg)`,
          }}
        />
      ))}
    </div>
  );
}
