import { createContext, useContext } from "react";
import { feestTheme, themeFor, type WheelVariant } from "../shared/variant";
import type { RoundGoal } from "../shared/channel";
export const VariantContext = createContext<WheelVariant>("beer");
/** Koekrad rounds: the word from `/koekrad <titel>`, shown as plain text. */
export const RoundTitleContext = createContext<string | undefined>(undefined);
/** Feestrad rounds: every goal; with more than one the whole page goes rainbow. */
export const GoalsContext = createContext<readonly RoundGoal[] | undefined>(
  undefined,
);
export function useTheme() {
  const variant = useContext(VariantContext);
  const word = useContext(RoundTitleContext);
  const goals = useContext(GoalsContext);
  const feest = (goals?.length ?? 0) > 1;
  const theme = feest ? feestTheme : themeFor(variant, word);
  return {
    ...theme,
    variant,
    haler: theme.drink + "haler",
    feest,
  };
}
