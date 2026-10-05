import type { WheelVariant } from "../shared/variant";
import { hashSecret } from "./auth";
export async function ratingLocator(teamId: string, variant: WheelVariant) {
  return hashSecret(`bierrad-ratings:${teamId}:${variant}`);
}
