import { RequestError } from "./session";
export function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    },
  });
}
/** Enforce a byte bound while reading, including chunked requests. */
export async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new RequestError(415, "invalid");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "invalid");
  let size = 0,
    text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new RequestError(413, "too_large");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try {
      return JSON.parse(text);
    } catch {
      throw new RequestError(400, "invalid");
    }
  } finally {
    reader.releaseLock();
  }
}
