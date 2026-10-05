import { useId } from "react";
import type { RatingSummary } from "../../shared/ratings";
const star =
  "M10 1.5 12.6 6.8 18.5 7.7 14.2 11.8 15.2 17.7 10 14.9 4.8 17.7 5.8 11.8 1.5 7.7 7.4 6.8Z";
/** SVG clipping preserves fractional stars (e.g. 1.8 and 4.3) at any size. */
export function StarGlyphs({ value }: { value: number }) {
  const id = useId().replaceAll(":", "");
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => {
        const fill = Math.min(1, Math.max(0, value - i));
        return (
          <g key={i} transform={`translate(${i * 22} 0)`}>
            <defs>
              <clipPath id={`${id}-${i}`}>
                <rect width={20 * fill} height="20" />
              </clipPath>
            </defs>
            <path d={star} className="star-empty" />
            <path
              d={star}
              className="star-filled"
              clipPath={`url(#${id}-${i})`}
            />
          </g>
        );
      })}
    </>
  );
}
export function RatingStars({
  rating,
  compact = false,
}: {
  rating: RatingSummary;
  compact?: boolean;
}) {
  const value = rating.count ? rating.average : 0;
  const formatted = value.toLocaleString("nl-NL", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  });
  return (
    <span
      className={`rating-stars${compact ? " compact-stars" : ""}`}
      aria-label={
        rating.count
          ? `${formatted} van 5 sterren, ${rating.count} beoordelingen`
          : "Nog geen beoordelingen"
      }
    >
      <svg viewBox="0 0 108 20" aria-hidden="true">
        <StarGlyphs value={value} />
      </svg>
      <small>
        {rating.count ? `${formatted} · ${rating.count}` : "Nog geen sterren"}
      </small>
    </span>
  );
}
