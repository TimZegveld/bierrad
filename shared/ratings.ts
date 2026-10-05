import type { WheelVariant } from "./variant";
export interface RatingSummary {
  average: number;
  count: number;
}
export interface RatingSettings {
  enabled: boolean;
  delayMinutes: number;
}
export const DEFAULT_RATING_SETTINGS: RatingSettings = {
  enabled: false,
  delayMinutes: 3,
};
export function validRatingSettings(value: unknown): value is RatingSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 2 &&
    typeof v.enabled === "boolean" &&
    typeof v.delayMinutes === "number" &&
    Number.isInteger(v.delayMinutes) &&
    v.delayMinutes >= 1 &&
    v.delayMinutes <= 30
  );
}
export interface RatingRound {
  drawId: string;
  opensAt: string;
  winners: { id: string; name: string }[];
}
export interface RatingStatus extends RatingSettings {
  rounds: RatingRound[];
}
export interface RatingBallot {
  variant: WheelVariant;
  round: RatingRound;
  expiresAt: string;
  submitted: boolean;
  serverNow: number;
}
