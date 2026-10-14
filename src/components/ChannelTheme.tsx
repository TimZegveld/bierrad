import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  bierfeestCopy,
  feestCopy,
  type ChannelVariant,
  type RoundGoal,
} from "../../shared/channel";
import { themeFor, themes } from "../../shared/variant";
import {
  BierfeestContext,
  GoalsContext,
  RoundTitleContext,
  VariantContext,
} from "../Theme";
import { Confetti } from "./Confetti";
const feest = (goals?: readonly RoundGoal[]) => (goals?.length ?? 0) > 1;
/** The moment a waiting round grows: "☕ → 🌈 Het Koffierad wordt een Feestrad!" */
function FeestGrowth({ goals }: { goals?: readonly RoundGoal[] }) {
  const count = goals?.length ?? 0;
  const previous = useRef(count);
  const [grown, setGrown] = useState<{
    from: number;
    goals: readonly RoundGoal[];
  }>();
  useEffect(() => {
    const before = previous.current;
    previous.current = count;
    // Only a round seen with fewer goals grows; a page opened mid-feest does not.
    if (!goals || before < 1 || count <= before || count < 2) return;
    setGrown({ from: before, goals });
    const timer = window.setTimeout(() => setGrown(undefined), 7000);
    return () => window.clearTimeout(timer);
  }, [count, goals]);
  if (!grown) return null;
  const added = themeFor(
    grown.goals.at(-1)!.variant,
    grown.goals.at(-1)!.title,
  );
  const first = themeFor(grown.goals[0].variant, grown.goals[0].title);
  return (
    <div className="feest-growth" role="status">
      <Confetti />
      <div className="feest-growth-card">
        <span className="feest-growth-icons" aria-hidden="true">
          {grown.from === 1 ? first.icon : feestCopy.icon} → {feestCopy.icon}
        </span>
        <strong>
          {grown.from === 1
            ? `Het ${first.name} wordt een ${feestCopy.name}!`
            : `Het ${feestCopy.name} groeit!`}
        </strong>
        <span>
          Er komt een {added.name} bij. Klik op {added.icon} onder de oproep in
          Slack om {added.drink} te halen.
        </span>
      </div>
    </div>
  );
}
/** The moment a waiting Bierrad round reaches the threshold: "🍻 → 🎉". Falling back is quiet. */
function BierfeestGrowth({ on }: { on?: boolean }) {
  const previous = useRef(on);
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const before = previous.current;
    previous.current = on;
    if (before !== false || !on) return;
    setGrown(true);
    const timer = window.setTimeout(() => setGrown(false), 7000);
    return () => window.clearTimeout(timer);
  }, [on]);
  if (!grown) return null;
  return (
    <div className="feest-growth bierfeest-growth" role="status">
      <Confetti party gold />
      <div className="feest-growth-card">
        <span className="feest-growth-icons" aria-hidden="true">
          {themes.beer.icon} → {bierfeestCopy.icon}
        </span>
        <strong>
          Het {themes.beer.name} wordt een {bierfeestCopy.name}!
        </strong>
        <span>
          Zoveel dorstige collega's: deze bierronde wordt gevierd. Klik op{" "}
          {themes.beer.icon} onder de oproep in Slack om mee te doen.
        </span>
      </div>
    </div>
  );
}
/** One binding serves coffee, water and cookie: the page follows the latest round. */
export function ChannelTheme({
  variant,
  word,
  goals,
  bierfeest,
  title,
  children,
}: {
  variant: ChannelVariant;
  /** Koekrad rounds: the round's word. */
  word?: string;
  /** The shown round's goals; more than one makes it a rainbow Feestrad. */
  goals?: readonly RoundGoal[];
  /** Bierrad rounds the server calls a Bierfeest: gold and foam. */
  bierfeest?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const theme = themeFor(variant, word);
  const party = feest(goals);
  const gold = !party && variant === "beer" && bierfeest === true;
  useEffect(() => {
    const root = document.documentElement.dataset;
    root.variant = variant;
    if (party) root.feest = "true";
    else delete root.feest;
    if (gold) root.bierfeest = "true";
    else delete root.bierfeest;
    document.title =
      title ??
      (party ? feestCopy.name : gold ? bierfeestCopy.name : theme.name);
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = theme.favicon;
  }, [variant, title, theme, party, gold]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset.feest;
      delete document.documentElement.dataset.bierfeest;
    },
    [],
  );
  return (
    <VariantContext.Provider value={variant}>
      <RoundTitleContext.Provider value={word}>
        <GoalsContext.Provider value={goals}>
          <BierfeestContext.Provider value={gold}>
            <FeestGrowth goals={goals} />
            {variant === "beer" && <BierfeestGrowth on={bierfeest} />}
            {children}
          </BierfeestContext.Provider>
        </GoalsContext.Provider>
      </RoundTitleContext.Provider>
    </VariantContext.Provider>
  );
}
