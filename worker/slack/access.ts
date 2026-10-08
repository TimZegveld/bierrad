import { themes, type WheelVariant } from "../../shared/variant";
/** Optional server-only secrets; deliberately absent from Vite and public config. */
export interface SlackSecrets {
  COFFEE_SLACK_BOT_TOKEN?: string;
  COFFEE_SLACK_CLIENT_ID?: string;
  COFFEE_SLACK_CLIENT_SECRET?: string;
  /** Verifies `/koffierad` slash commands; only the Koffierad app receives requests. */
  COFFEE_SLACK_SIGNING_SECRET?: string;
  SLACK_BOT_TOKEN?: string;
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  /** Verifies `/bierrad` slash commands; only the Bierrad app receives them. */
  SLACK_SIGNING_SECRET?: string;
}
/** Marks rounds started by a channel-bound wheel (bound after Sign in with Slack). */
export const CHANNEL_GRANT = "slack-channel";
export function loginConfigured(env: SlackSecrets): boolean {
  return (
    !!env.SLACK_BOT_TOKEN &&
    !!env.SLACK_CLIENT_SECRET &&
    /^\d{1,20}\.\d{1,20}$/.test(env.SLACK_CLIENT_ID ?? "")
  );
}
/**
 * Only channel rounds hold Slack rights; anything else, including sessions
 * once started with Sign in with Slack, fails closed.
 */
export function slackAllowed(
  hash: string | undefined,
  env: SlackSecrets,
): boolean {
  return hash === CHANNEL_GRANT && loginConfigured(env);
}

export function slackEnvironment(
  env: SlackSecrets,
  variant: WheelVariant = "beer",
): SlackSecrets {
  // Every variant names its own app; there is no fallback to another bot.
  return themes[variant].slackApp === "coffee"
    ? {
        SLACK_BOT_TOKEN: env.COFFEE_SLACK_BOT_TOKEN,
        SLACK_CLIENT_ID: env.COFFEE_SLACK_CLIENT_ID,
        SLACK_CLIENT_SECRET: env.COFFEE_SLACK_CLIENT_SECRET,
      }
    : {
        SLACK_BOT_TOKEN: env.SLACK_BOT_TOKEN,
        SLACK_CLIENT_ID: env.SLACK_CLIENT_ID,
        SLACK_CLIENT_SECRET: env.SLACK_CLIENT_SECRET,
      };
}
