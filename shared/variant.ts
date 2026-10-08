export type WheelVariant = "beer" | "coffee" | "water" | "cookie";
export const wheelVariants: readonly WheelVariant[] = ["beer", "coffee", "water", "cookie"];
export function isWheelVariant(value: unknown): value is WheelVariant {
  return (wheelVariants as readonly unknown[]).includes(value);
}
/**
 * Wheels anyone can open on their own: locally, in the switcher and as a plain
 * live session. Water and the Koekrad exist only as rounds of a channel-bound
 * Koffierad.
 */
export type StandaloneVariant = Extract<WheelVariant, "beer" | "coffee">;
export const standaloneVariants: readonly StandaloneVariant[] = ["beer", "coffee"];
export function isStandaloneVariant(value: unknown): value is StandaloneVariant {
  return (standaloneVariants as readonly unknown[]).includes(value);
}
/** Slack reactions a variant counts; each variant reads only its own. */
export type SlackReaction = "beers" | "coffee" | "droplet" | "cookie";
/** The Slack app whose server-side credentials a variant uses; water and the Koekrad share the Koffierad app. */
export type SlackApp = "beer" | "coffee";
export interface WheelTheme {
  name: string;
  icon: string;
  winnerIcon: string;
  drink: string;
  reaction: SlackReaction;
  slackApp: SlackApp;
  storage: string;
  favicon: string;
  badge: string;
  question: string;
  crew: string;
  brigade: string;
  footer: string;
  finale: string;
  resultOne: string;
  resultMany: string;
  /** Closing line under the final result. */
  ending: string;
  /** Wheel segment colours; absent uses the default palette. */
  wheelColors?: readonly string[];
}
/**
 * The word of a Koekrad round, from a signed `/koekrad`: one lowercase word of
 * 2 to 20 letters with single inner hyphens. No spaces, digits, punctuation or
 * markup, so it can never carry a mention, link, emoji code or formatting.
 * Display only; it never authorizes or selects anything.
 */
export function roundTitle(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length > 40) return;
  const word = raw.normalize("NFC").toLocaleLowerCase("nl");
  return word.length >= 2 &&
    word.length <= 20 &&
    /^[a-zà-öø-ÿ]+(?:-[a-zà-öø-ÿ]+)*$/.test(word)
    ? word
    : undefined;
}
/** The Koekrad's texts for one word: "taart" makes Taartrad and taarthaler. */
function cookieTheme(word: string): WheelTheme {
  const upper = word.toLocaleUpperCase("nl");
  return {
    // Dutch capitalizes the digraph: ijs makes IJsrad.
    name: `${word.startsWith("ij") ? "IJ" : upper[0]}${word.slice(word.startsWith("ij") ? 2 : 1)}rad`,
    icon: "🍪",
    winnerIcon: "🍪",
    drink: word,
    reaction: "cookie",
    slackApp: "coffee",
    storage: "koekrad",
    favicon: "./cookie-icon.svg",
    badge: `Tijd voor een ${word}ronde`,
    question: `Wie haalt de ${word}?`,
    crew: `${word}ploeg`,
    brigade: `${word}brigade`,
    footer: "Met liefde gebakken voor de trek van de afdeling.",
    finale: `DE ${upper}BRIGADE VAN DEZE RONDE`,
    resultOne: `mag de ${word} halen.`,
    resultMany: `halen de ${word}.`,
    ending: "Er is altijd ruimte voor iets lekkers. Maak ons trots.",
    wheelColors: [
      "#dba872",
      "#f2d6ae",
      "#c58f62",
      "#f6e6cc",
      "#d9a7a2",
      "#b98d68",
      "#ebc394",
      "#cdb892",
    ],
  };
}
export const DEFAULT_COOKIE_WORD = "koek";
export const themes: Record<WheelVariant, WheelTheme> = {
  beer: {
    name: "Bierrad",
    icon: "🍻",
    winnerIcon: "🍺",
    drink: "bier",
    reaction: "beers",
    slackApp: "beer",
    storage: "bierrad",
    favicon: "./favicon.svg",
    badge: "Vrijdag begint hier",
    question: "Wie haalt deze week het bier?",
    crew: "vrijdagploeg",
    brigade: "bierbrigade",
    footer: "Met liefde gebrouwen voor de vrijdagmiddag.",
    finale: "DE BIERBRIGADE VAN DEZE WEEK",
    resultOne: "mag deze week het bier halen.",
    resultMany: "halen deze week het bier.",
    ending: "Het volk heeft dorst. Maak ons trots.",
  },
  coffee: {
    name: "Koffierad",
    icon: "☕",
    winnerIcon: "☕",
    drink: "koffie",
    reaction: "coffee",
    slackApp: "coffee",
    storage: "koffierad",
    favicon: "./coffee-icon.svg",
    badge: "Tijd voor een koffieronde",
    question: "Wie haalt de volgende koffie?",
    crew: "koffieploeg",
    brigade: "koffiebrigade",
    footer: "Met liefde gemaakt voor de koffieliefhebbers.",
    finale: "DE KOFFIEBRIGADE VAN DEZE RONDE",
    resultOne: "mag de volgende koffie halen.",
    resultMany: "halen de volgende koffie.",
    ending: "Het koffieapparaat wacht op je. Brouw ons trots.",
    wheelColors: [
      "#d7a575",
      "#ebc9a6",
      "#91aaa0",
      "#f4dfbb",
      "#b9a6bc",
      "#caa58b",
      "#bec9a7",
      "#e6baab",
    ],
  },
  water: {
    name: "Waterrad",
    icon: "💧",
    winnerIcon: "🚰",
    drink: "water",
    reaction: "droplet",
    slackApp: "coffee",
    storage: "waterrad",
    favicon: "./water-icon.svg",
    badge: "Tijd voor een waterronde",
    question: "Wie haalt het water?",
    crew: "waterploeg",
    brigade: "waterbrigade",
    footer: "Met liefde getapt voor de dorstige afdeling.",
    finale: "DE WATERBRIGADE VAN DEZE RONDE",
    resultOne: "mag het water halen.",
    resultMany: "halen het water.",
    ending: "Rondje gemeentepils van de zaak! Hydrateer ons trots.",
    wheelColors: [
      "#7cc6d9",
      "#bfe5ee",
      "#9fc9b4",
      "#e3f3f6",
      "#a9b8e0",
      "#86b7c9",
      "#c4dfc9",
      "#d6e6f5",
    ],
  },
  cookie: cookieTheme(DEFAULT_COOKIE_WORD),
};
/** A variant's theme; a Koekrad round with a valid title takes that word. */
export function themeFor(variant: WheelVariant, title?: string): WheelTheme {
  const word = variant === "cookie" ? roundTitle(title) : undefined;
  return word ? cookieTheme(word) : themes[variant];
}
export function localHash(variant: WheelVariant): string {
  return `#/${variant}`;
}
/** The local wheel route of a variant, or undefined for any other hash. */
export function localVariant(hash: string): StandaloneVariant | undefined {
  if (!hash) return "beer";
  const name = /^#\/([a-z]+)$/.exec(hash)?.[1];
  return isStandaloneVariant(name) ? name : undefined;
}
/**
 * Retired routes open a local wheel, so saved links keep working: old water
 * and Koffierad Slack routes the Koffierad, the removed Bierrad Slack start
 * and its session join links the Bierrad.
 */
export function retiredRoute(hash: string): string | undefined {
  if (/^#\/(?:water|(?:water|coffee)-slack(?:\/[a-z]+)?)$/.test(hash))
    return localHash("coffee");
  if (/^#\/(?:slack(?:\/[a-z]+)?|meedoen(?:-login)?\/[A-Za-z0-9._-]+)$/.test(hash))
    return localHash("beer");
}
/** The variant whose Slack reaction this is; reactions are never shared. */
export function reactionVariant(reaction: SlackReaction): WheelVariant {
  return wheelVariants.find((v) => themes[v].reaction === reaction) ?? "beer";
}
