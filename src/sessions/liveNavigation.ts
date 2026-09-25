import type { ClientRole } from "../domain/models";
export function parseLiveRoute(
  hash: string,
): {
  role: ClientRole;
  capability: string;
  spectatorCapability?: string;
} | null {
  const match =
    /^#\/(host|live)\/([a-f0-9]{32}\.[a-f0-9]{64})(?:\/([a-f0-9]{32}\.[a-f0-9]{64}))?$/.exec(
      hash,
    );
  return match
    ? {
        role: match[1] === "host" ? "host" : "spectator",
        capability: match[2],
        spectatorCapability: match[1] === "host" ? match[3] : undefined,
      }
    : null;
}
export function liveLink(role: ClientRole, capability: string): string {
  return `${location.origin}${location.pathname}#/${role === "host" ? "host" : "live"}/${capability}`;
}
export function configuredApiUrl(): string | undefined {
  const configured = import.meta.env.VITE_API_URL as string | undefined;
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    if (
      url.protocol !== "https:" &&
      !(
        import.meta.env.DEV &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )
    )
      return undefined;
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}
