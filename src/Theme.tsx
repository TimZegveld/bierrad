import { createContext, useContext } from "react";
import {
  bierfeestTheme,
  feestTheme,
  themeFor,
  type WheelVariant,
} from "../shared/variant";
import type { RoundGoal } from "../shared/channel";
export const VariantContext = createContext<WheelVariant>("beer");
/** Koekrad rounds: the word from `/koekrad <titel>`, shown as plain text. */
export const RoundTitleContext = createContext<string | undefined>(undefined);
/** Feestrad rounds: every goal; with more than one the whole page goes rainbow. */
export const GoalsContext = createContext<readonly RoundGoal[] | undefined>(
  undefined,
);
/** Bierrad channel rounds the server calls a Bierfeest: the gold look only. */
export const BierfeestContext = createContext(false);
export function useTheme() {
  const variant = useContext(VariantContext);
  const word = useContext(RoundTitleContext);
  const goals = useContext(GoalsContext);
  const party = useContext(BierfeestContext);
  const feest = (goals?.length ?? 0) > 1;
  const bierfeest = !feest && party && variant === "beer";
  const theme = feest
    ? feestTheme
    : bierfeest
      ? bierfeestTheme
      : themeFor(variant, word);
  return {
    ...theme,
    variant,
    haler: theme.drink + "haler",
    feest,
    bierfeest,
  };
}
