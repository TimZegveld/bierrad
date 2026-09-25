import { equalHash, hashSecret } from "../auth";
/** Optional server-only secrets; deliberately absent from Vite and public config. */
export interface SlackSecrets {
  SLACK_BOT_TOKEN?: string;
  SLACK_START_GRANT?: string;
}
export function currentGrant(
  env: SlackSecrets,
  now = Date.now(),
): { hash: string; expiresAt: number } | undefined {
  if (!env.SLACK_BOT_TOKEN || !env.SLACK_START_GRANT) return;
  try {
    const grant = JSON.parse(env.SLACK_START_GRANT);
    if (
      /^[a-f0-9]{64}$/.test(grant.hash) &&
      Number.isSafeInteger(grant.expiresAt) &&
      grant.expiresAt > now
    )
      return { hash: grant.hash, expiresAt: grant.expiresAt };
  } catch {
    /* Misconfigured secrets fail closed. */
  }
}
export async function authorizeStart(raw: string | null, env: SlackSecrets) {
  if (!raw || !/^Bearer [a-f0-9]{64}$/.test(raw)) return;
  const hash = await hashSecret(raw.slice(7));
  const grant = currentGrant(env);
  return grant && equalHash(hash, grant.hash) ? grant : undefined;
}
export function slackAllowed(
  hash: string | undefined,
  env: SlackSecrets,
): boolean {
  const grant = currentGrant(env);
  return !!hash && !!grant && equalHash(hash, grant.hash);
}
