/** Server-only Slack client. No SDK, logging or user-controlled fetch targets. */
export class SlackError extends Error {
  constructor(
    public code: string,
    public retryAfterMs = 60000,
    public uncertain = false,
  ) {
    super(code);
  }
}
export type SlackObject = Record<string, unknown>;
export function object(value: unknown): SlackObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SlackError("slack_response");
  return value as SlackObject;
}
export class SlackApiClient {
  constructor(
    private token: string,
    private fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  async call(
    method: "reactions.get" | "users.info" | "chat.postMessage",
    body: SlackObject,
    signal?: AbortSignal,
  ): Promise<SlackObject> {
    const posting = method === "chat.postMessage";
    try {
      const query = posting
        ? ""
        : "?" +
          new URLSearchParams(
            Object.entries(body).map(([k, v]) => [k, String(v)]),
          );
      const response = await this.fetcher(
        `https://slack.com/api/${method}${query}`,
        {
          method: posting ? "POST" : "GET",
          redirect: "manual",
          headers: {
            Authorization: `Bearer ${this.token}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          ...(posting ? { body: JSON.stringify(body) } : {}),
          signal: signal ?? AbortSignal.timeout(10000),
        },
      );
      if (response.status === 429) {
        const seconds = Number(response.headers.get("Retry-After"));
        throw new SlackError(
          "slack_rate_limited",
          Number.isFinite(seconds) && seconds > 0
            ? Math.ceil(seconds * 1000)
            : 60000,
        );
      }
      if (!response.ok)
        throw new SlackError("slack_unavailable", 60000, posting);
      // Bound Slack responses too; never return or retain entire messages/profiles.
      const reader = response.body?.getReader();
      if (!reader) throw new SlackError("slack_response", 60000, posting);
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        length += part.value.byteLength;
        if (length > 1048576) {
          await reader.cancel();
          throw new SlackError("slack_response", 60000, posting);
        }
        chunks.push(part.value);
      }
      const all = new Uint8Array(length);
      let offset = 0;
      for (const c of chunks) {
        all.set(c, offset);
        offset += c.length;
      }
      const data = object(JSON.parse(new TextDecoder().decode(all)));
      if (data.ok !== true) {
        // Only definite documented rejections are eligible for manual retry.
        const rejected = [
          "not_authed",
          "invalid_auth",
          "token_revoked",
          "missing_scope",
          "not_in_channel",
          "channel_not_found",
          "is_archived",
          "no_permission",
          "message_not_found",
          "user_not_found",
          "invalid_arguments",
          "restricted_action",
          "ratelimited",
        ];
        throw new SlackError(
          data.error === "ratelimited"
            ? "slack_rate_limited"
            : "slack_rejected",
          60000,
          posting && !rejected.includes(String(data.error)),
        );
      }
      return data;
    } catch (error) {
      if (error instanceof SlackError) {
        if (posting && error.code === "slack_response") error.uncertain = true;
        throw error;
      }
      throw new SlackError("slack_unavailable", 60000, posting);
    }
  }
}
