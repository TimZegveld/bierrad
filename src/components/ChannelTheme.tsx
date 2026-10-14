import { useEffect, type ReactNode } from "react";
import { themeFor } from "../../shared/variant";
import type { ChannelVariant } from "../../shared/channel";
import { RoundTitleContext, VariantContext } from "../Theme";
export function ChannelTheme({
  variant,
  word,
  title,
  children,
}: {
  variant: ChannelVariant;
  /** Koekrad rounds: the round's word. */
  word?: string;
  title?: string;
  children: ReactNode;
}) {
  const theme = themeFor(variant, word);
  useEffect(() => {
    document.documentElement.dataset.variant = variant;
    document.title = title ?? theme.name;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = theme.favicon;
  }, [variant, title, theme]);
  return (
    <VariantContext.Provider value={variant}>
      <RoundTitleContext.Provider value={word}>
        {children}
      </RoundTitleContext.Provider>
    </VariantContext.Provider>
  );
}
