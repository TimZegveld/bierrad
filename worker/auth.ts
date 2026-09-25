/** 256 secret bits; the separately random locator grants no access. */
export function randomHex(bytes = 32): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export function parseCapability(value: string | null) {
  if (!value || !/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(value)) return null;
  const [locator, secret] = value.split(".");
  return { locator, secret };
}
export async function hashSecret(secret: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function equalHash(a: string, b: string): boolean {
  return crypto.subtle.timingSafeEqual(
    new TextEncoder().encode(a),
    new TextEncoder().encode(b),
  );
}
