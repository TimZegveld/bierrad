# Slack security review — 2026-09-25

Reviewed against every section of SECURITY.md. Slack was explicitly requested; scheduling remains out of scope.

## Authorization and trust boundary

Public hosts cannot use the workspace bot. A separate random 256-bit expiring startcapability authorizes Slack session creation. Only its SHA-256 hash/expiry is stored in the Worker secret SLACK_START_GRANT. A session keeps its grant hash privately. Import and sending recheck that the grant is current and the bot configured; rotating/deleting the grant disables subsequent Slack operations for old sessions. Session expiry is at most eight hours and never exceeds grant expiry. The grant is a shared organizer permission, not per-user Slack authorization: any organizer with it can import a permalink accessible to the bot. Restrict bot conversation membership accordingly. No general public Slack proxy, public roster/list endpoint, or public source attachment.

Host and spectator capability checks, exact Origin allowlist, request size/creation/mutation limits and expiry remain. Slack import checks host, grant, phase and revision; stores a busy lease and cooldown before network I/O. Changes/draws are locked during import. Responses re-read durable state before applying, refusing expired/revoked/replaced operations. Every result request ignores client winner/target data: target and official names are frozen server-side when the authoritative draw starts.

## Data and network

SLACK_BOT_TOKEN is server-only. The optional secret type is isolated under worker/slack; generated Cloudflare binding types remain generated. No SDK/dependency added. The existing nodejs_compat runtime supplies node:crypto timingSafeEqual; the Worker typecheck includes the existing Node types. Only official reactions.get/users.info/chat.postMessage endpoints are callable. A user URL is parsed, never fetched; redirects are manual and non-2xx rejected, preventing credential forwarding. Bounded response bodies, strict schemas, timeouts, no raw error passthrough, no logs. No email scope, no persistent user cache. Four concurrent lookups within one import; each deduplicated user is resolved once. Slack rate limits impose a minimum host retry deadline. An import waits at least a minute; distributed sessions still share Slack workspace quota and may hit upstream limits.

Public DTOs explicitly contain opaque session IDs and display names. Only hosts get allowlisted enabled/source/count/sync-time/result-status fields. No browser gets a Slack channel/user/message identifier, permalink from server, credential or mapping. The host's pasted link exists briefly in their input and HTTPS request body; it is cleared on successful import. Spectators get no Slack metadata or controls. Live rosters/capabilities are not persisted in browser storage. Expiry deletes the session including source, mapping and outbox. Provider backups and already delivered Slack replies follow their own retention policies; ending a session does not delete Slack messages.

External names are normalized/bounded and rendered as React text; Slack output uses plain_text blocks and an escaped non-parsed fallback, no broadcast/mentions/unfurls. Synthetic fixtures only. Maximum 100 participants and one current posting record; no historical directory/results database.

## Durable posting and failure semantics

At draw creation, capture the official winner names and validated source in a pending job, with not-before equal to the last spin end. A Durable Object alarm advances and sends without browser callbacks. Before external I/O, synchronously claim posting, save it, arm recovery, and await storage.sync. Reentrant alarms find posting and do not send. Pending/posting blocks replacing the job with another draw/reset. Definitive success persists posted; definitive rejection persists failed plus retry deadline. Only an authorized host can retry a definite failure after that deadline. Automatic completion retries of posted/failed/uncertain jobs never send.

Slack does not give this implementation a documented transactional exactly-once boundary. If Slack accepts and the process/network fails before acknowledgement is durably saved, the job becomes uncertain (after 120 seconds for crash recovery). We **do not resend uncertain delivery**, sacrificing guaranteed delivery to avoid duplicate automatic posts. A crash between recording posting and sending can therefore lose a message. Host must inspect the thread; there is deliberately no ambiguous retry button. We do not claim an undocumented client_msg_id deduplication guarantee. Revocation cannot recall an already in-flight request. Failures never alter official winners.

## Verification and deployment limits

Automated tests cover strict URL parsing/SSRF cases, complete reactions, deduplication, names/filtering, refresh and opaque identity, safe DTOs, grant expiry/rotation, source rights, deterministic result text, failure/retry, disconnected alarm completion, reentrant completion and crash recovery. Existing local/remote/capability tests remain. Frontend/backend typechecks, frontend build and Worker dry-run must pass before publication. No configured lint task. Review source/diff/build for secrets, unsafe VITE variables, private data and dependencies.

Production activation requires an installed app with reactions:read/users:read/chat:write, bot conversation membership, SLACK_BOT_TOKEN and a privately provisioned SLACK_START_GRANT. No bot token was configured during implementation; real Slack acceptance remains pending. The feature fails closed without both secrets; manual use remains available.

## Required answers

1. Public URL reveals private participants without a capability? **No.**
2. Spectator can import or refresh Slack? **No.**
3. Slack bot token in browser? **No.**
4. Slack user IDs in browser? **No.**
5. Pasted URL directly fetched? **No.**
6. Email access required? **No.**
7. Posted winners can differ from the official draw? **No:** captured from the server instruction.
8. Normal retries/reconnects duplicate a post? **No:** durable claim; ambiguous outcomes are never retried. Not an exactly-once delivery guarantee.
9. Draw remains valid after post failure? **Yes.**
10. Permanent employee directory or identifiable result history? **No:** session TTL; delivered replies follow Slack retention.

Validation completed: 34 tests pass (23 frontend/domain/controller and 11 Worker/Slack tests), including viewer WebSocket privacy and disconnected automatic posting. Desktop synthetic Slack-host review and a 390px mobile iframe confirmed the controls, unique final winners and no live browser storage. A rotated-SVG horizontal overflow found in mobile review was fixed with bounded clipping around the wheel, preserving its pointer/shadow. Production build and both typechecks passed; runtime dependency audit found zero known vulnerabilities. Real Slack workspace testing remains pending configuration.
