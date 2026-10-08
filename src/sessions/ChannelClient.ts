import {
  channelApps,
  type ChannelApp,
  type ChannelCommand,
  type ChannelCommandResult,
} from "../../shared/channel";

const hex = String.raw`[a-f0-9]{32}\.[a-f0-9]{64}`;
/** The view-only word link of a channel: 5 chained words. */
const words = String.raw`[a-z]{2,8}(?:-[a-z]{2,8}){4}`;
export type ChannelBindFailure =
  | "denied"
  | "forbidden"
  | "expired"
  | "unavailable"
  | "busy"
  | "not_in_channel";
export type MemberLoginFailure =
  | "denied"
  | "forbidden"
  | "expired"
  | "unavailable"
  | "busy";
export type ChannelRoute = { app: ChannelApp } & (
  | { page: "bind"; failure?: ChannelBindFailure }
  | { page: "memberFailure"; failure: MemberLoginFailure }
  | { page: "wheel"; capability: string; requestCapability?: string }
  | { page: "view"; capability: string }
);
/**
 * Channel links live only in the fragment, never in storage or requests to
 * Pages. `#/koffie…` routes belong to the Koffierad, `#/bier…` to the Bierrad.
 */
export function parseChannelRoute(hash: string): ChannelRoute | null {
  const prefix = /^#\/(koffie|bier)(?=[/-])/.exec(hash);
  if (!prefix) return null;
  const app: ChannelApp = prefix[1] === "bier" ? "beer" : "coffee";
  const route = prefix[1];
  const bind = new RegExp(
    `^#/${route}-koppelen(?:/(denied|forbidden|expired|unavailable|busy|not_in_channel))?$`,
  ).exec(hash);
  if (bind)
    return {
      app,
      page: "bind",
      ...(bind[1] ? { failure: bind[1] as ChannelBindFailure } : {}),
    };
  const member = new RegExp(
    `^#/${route}-login/(denied|forbidden|expired|unavailable|busy)$`,
  ).exec(hash);
  if (member)
    return { app, page: "memberFailure", failure: member[1] as MemberLoginFailure };
  const request = new RegExp(`^#/${route}/(${hex})$`).exec(hash);
  if (request) return { app, page: "wheel", capability: request[1] };
  const view = new RegExp(`^#/${route}/(${words})$`).exec(hash);
  if (view) return { app, page: "view", capability: view[1] };
  const admin = new RegExp(`^#/${route}-beheer/(${hex})/(${hex})$`).exec(hash);
  return admin
    ? { app, page: "wheel", capability: admin[1], requestCapability: admin[2] }
    : null;
}
export function channelLink(app: ChannelApp, requestCapability: string): string {
  return `${location.origin}${location.pathname}#/${channelApps[app].route}/${requestCapability}`;
}
/** Without the scheme: short enough to type on another screen. */
export function channelViewLink(app: ChannelApp, viewerCapability: string): string {
  return `${location.host}${location.pathname}#/${channelApps[app].route}/${viewerCapability}`;
}
/** The word link as a route, to open it here for just watching. */
export function channelViewRoute(app: ChannelApp, viewerCapability: string): string {
  return `#/${channelApps[app].route}/${viewerCapability}`;
}
export function channelBindUrl(
  apiUrl: string,
  app: ChannelApp,
  channelId: string,
): string {
  return `${apiUrl}/auth/slack/${app === "beer" ? "beer-channel" : "channel"}/${channelId}`;
}
const messages: Record<string, string> = {
  round_active: "Er loopt al een ronde. Kijk mee of doe mee onder de oproep in Slack.",
  round_limit: "Vandaag zijn er al genoeg rondes gestart. Morgen weer!",
  slack_post_failed:
    "Het rad kon niet in het kanaal posten. Nodig de bot eerst uit in het kanaal.",
  slack_uncertain:
    "Het is onzeker of de oproep is geplaatst. Kijk even in het kanaal voordat je het opnieuw probeert.",
  rate_limited: "Even rustig aan. Probeer over een minuut opnieuw.",
  unavailable:
    "Deze link werkt niet meer. Vraag de beheerder van het kanaal om een nieuwe aanvraaglink.",
  forbidden: "Alleen de beheerder van dit rad kan dit aanpassen.",
  review_closed: "Stemmen is voorbij. De reviews staan in Slack.",
  review_done: "Je hebt al gestemd. Bedankt!",
  review_forbidden:
    "Je kunt deze ronde niet beoordelen: je deed niet mee of je bent zelf de haler.",
  invalid: "Geef alle halers sterren; een review mag hooguit 280 tekens zijn.",
};
export class ChannelApiError extends Error {
  constructor(public code: string) {
    super(
      messages[code] ??
        "Het rad is nu niet bereikbaar. Probeer het zo opnieuw.",

    );
  }
}
export async function channelRequest(
  apiUrl: string,
  capability: string,
  command?: ChannelCommand,
  fetcher: typeof fetch = fetch,
): Promise<ChannelCommandResult> {
  let response: Response;
  try {
    response = await fetcher(`${apiUrl.replace(/\/$/, "")}/api/channel`, {
      method: command ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${capability}`,
        ...(command ? { "Content-Type": "application/json" } : {}),
      },
      ...(command ? { body: JSON.stringify(command) } : {}),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ChannelApiError("network");
  }
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new ChannelApiError(
      data && typeof data === "object" && "code" in data
        ? String(data.code)
        : "network",
    );
  return data as ChannelCommandResult;
}
