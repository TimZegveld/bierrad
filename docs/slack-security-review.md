# Slack security review — 2026-09-25

Reviewed against every section of SECURITY.md. Slack was explicitly requested; scheduling remains out of scope.

## Authorization and trust boundary

Public hosts cannot use the workspace bot. A separate random 256-bit expiring startcapability authorizes Slack session creation. Only its SHA-256 hash/expiry is stored in the Worker secret SLACK_START_GRANT. A session keeps its grant hash privately. Import and sending recheck that the grant is current and the bot configured; rotating/deleting the grant disables subsequent Slack operations for old sessions. Session expiry is at most eight hours and never exceeds grant expiry. The grant is a shared organizer permission, not per-user Slack authorization: any organizer with it can import a permalink accessible to the bot. Restrict bot conversation membership accordingly. No general public Slack proxy, public roster/list endpoint, or public source attachment.

Host and spectator capability checks, exact Origin allowlist, request size/creation/mutation limits and expiry remain. Slack import checks host, grant, phase and revision; stores a busy lease and cooldown before network I/O. Changes/draws are locked during import. Responses re-read durable state before applying, refusing expired/revoked/replaced operations. Every result request ignores client winner/target data: target and official names are frozen server-side when the authoritative draw starts.

## Data and network

SLACK_BOT_TOKEN is server-only. The optional secret type is isolated under worker/slack; generated Cloudflare binding types remain generated. No SDK/dependency added. The existing nodejs_compat runtime supplies node:crypto timingSafeEqual; the Worker typecheck includes the existing Node types. Only official reactions.get/users.info/chat.postMessage endpoints are callable. A user URL is parsed, never fetched; redirects are manual and non-2xx rejected, preventing credential forwarding. Bounded response bodies, strict schemas, timeouts, no raw error passthrough, no logs. No email scope, no persistent user cache. Four concurrent lookups within one import; each deduplicated user is resolved once. Slack rate limits impose a minimum host retry deadline. An import waits at least a minute; distributed sessions still share Slack workspace quota and may hit upstream limits.

Public DTOs explicitly contain opaque session IDs and display names. Only hosts get allowlisted enabled/source/count/sync-time/result-status fields. No browser gets a Slack channel/user/message identifier, permalink from server, credential or mapping. The host's pasted link exists briefly in their input and HTTPS request body; it is cleared on successful import. Spectators get no Slack metadata or controls. Live rosters/capabilities are not persisted in browser storage. Expiry deletes the session including source, mapping and outbox. Provider backups and already delivered Slack replies follow their own retention policies; ending a session does not delete Slack messages.

External names are normalized/bounded and rendered as React text; Slack output uses structured rich_text blocks and an escaped non-parsed fallback. Only server-resolved winner identities become explicit user mention elements; manual names remain literal text nodes. No broadcast/group mentions/links/unfurls. Synthetic fixtures only. Maximum 100 participants and one current posting record; no historical directory/results database.

## Durable posting and failure semantics

At draw creation, capture the official winner names and validated source in a pending job, with not-before equal to the last spin end. A Durable Object alarm advances and sends without browser callbacks. Before external I/O, synchronously claim posting, save it, arm recovery, and await storage.sync. Reentrant alarms find posting and do not send. Pending/posting blocks replacing the job with another draw/reset. Definitive success persists posted; definitive rejection persists failed plus retry deadline. Only an authorized host can retry a definite failure after that deadline. Automatic completion retries of posted/failed/uncertain jobs never send.

Slack does not give this implementation a documented transactional exactly-once boundary. If Slack accepts and the process/network fails before acknowledgement is durably saved, the job becomes uncertain (after 120 seconds for crash recovery). We **do not resend uncertain delivery**, sacrificing guaranteed delivery to avoid duplicate automatic posts. A crash between recording posting and sending can therefore lose a message. Host must inspect the thread; there is deliberately no ambiguous retry button. We do not claim an undocumented client_msg_id deduplication guarantee. Revocation cannot recall an already in-flight request. Failures never alter official winners.

## Verification and deployment limits

Automated tests cover strict URL parsing/SSRF cases, complete reactions, deduplication, names/filtering, refresh and opaque identity, safe DTOs, grant expiry/rotation, source rights, deterministic result text, failure/retry, disconnected alarm completion, reentrant completion and crash recovery. Existing local/remote/capability tests remain. Frontend/backend typechecks, frontend build and Worker dry-run must pass before publication. No configured lint task. Review source/diff/build for secrets, unsafe VITE variables, private data and dependencies.

Production activation requires an installed app with reactions:read/users:read/chat:write, bot conversation membership, SLACK_BOT_TOKEN and a privately provisioned SLACK_START_GRANT. The initial implementation had no bot token configured. On 2026-09-28 the user configured it and demonstrated a successful real thread reply. The new mention rendering still requires a real draw acceptance check. The feature fails closed without both secrets; manual use remains available.

## Decimal rating emoji review — 2026-10-06

Explicitly requested by the owner and reviewed against every section of SECURITY.md. Both anonymous review replies and settled channel calls use exactly five structured `emoji` elements per rated winner. Names come only from the fixed server-side set (`star`, `bierrad_star_empty`, `bierrad_star_1` through `bierrad_star_9`); no user-provided name or image URL is accepted. Round once to one decimal, then use that same value for the star fill and printed score. Fallback text uses fixed emoji shortcodes with the escaped names/text and existing `parse: none` settings. Anonymous review texts remain literal text elements in separate bullets, including emoji-looking strings; only frozen winner identities become mentions. Conflict resolution with PR 34 preserves its separate review bullets alongside the five-star display, with SECURITY.md and synthetic unit/integration assertions aligned to both changes.

No new API endpoint, scope, secret, environment variable, dependency, capability, network request, retention or storage is introduced. Authorization, review eligibility, delivery claims and retry limits are unchanged. PNGs are original deterministic geometric assets without company or employee data. Uploading them is a manual workspace step; no production Slack post or upload was made during validation. SECURITY.md's former whole-star output description is updated to reflect the owner's requested tenths. Tests cover every tenth, rounding carry, both message types, multiple winners and literal review text; existing synthetic Worker integration tests retain their security assertions.

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

Validation completed: 34 tests pass (23 frontend/domain/controller and 11 Worker/Slack tests), including viewer WebSocket privacy and disconnected automatic posting. Desktop synthetic Slack-host review and a 390px mobile iframe confirmed the controls, unique final winners and no live browser storage. A rotated-SVG horizontal overflow found in mobile review was fixed with bounded clipping around the wheel, preserving its pointer/shadow. Production build and both typechecks passed; runtime dependency audit found zero known vulnerabilities. The user subsequently confirmed the first real thread reply on 2026-09-28.


## Winner mentions and icon review — 2026-09-28

The user explicitly requested tagging winners, superseding the initial no-mentions requirement for official Slack winners only. SECURITY.md remains unchanged. At draw creation, reverse-map opaque winner IDs to validated private Slack identities and freeze them in the temporary job. Retry recipients cannot drift after later mapping changes. No lookup by name, no new API method/scope, no user IDs in HTTP/WebSocket DTOs. The posting request sends these identities back only to the same Slack integration for intended mentions. Plain text elements carry manual names, including hostile-looking markup, without interpreting it. The fallback escapes special characters and disables automatic parsing. Broadcast mentions cannot be generated by participant text. Legacy jobs without the optional identity array remain supported during their existing TTL.

Tests cover equal display names, mixed manual/Slack winners, exact official identity mapping, invalid identity fallback, frozen retry identity, legacy jobs, HTTP/WS privacy and actual Worker outbound mention payloads. Icon SVG/PNG contains only the existing generic vector brand, no profile photos or employee data. No runtime or development dependency was added; PNG was exported with a temporary CLI. The app icon is uploaded in Slack settings, without chat:write.customize or request-level icon overrides.

Mention release validation after integrating the current main: 39 tests pass (27 frontend and 12 Worker/Slack), both typechecks and both production builds pass. Diff/dependency/secret checks passed; no dependency changes, no private fields in frontend artifacts. The 1024px icon was visually reviewed. Slack mention rendering is verified against the documented payload and the mocked Worker integration; a real new draw is the remaining visual acceptance check.

## Koffierad review — 2026-09-28

Explicitly reviewed against every SECURITY.md section; the user authorized the coffee Slack variant. SECURITY.md remains unchanged. No new dependencies, scopes, external API methods, logging, scheduling or public participant endpoints. Standalone remains available.

The creation body accepts only an optional allowlisted beer/coffee variant; omitted means beer for compatibility. Persist this outside the draw engine in private session state and expose only the non-sensitive enum in the allowlisted DTO. No command can change it. Refresh/reset/draw cannot discard the session variant. Host and spectator keep using separate expiring capabilities, unchanged authorization and rate limits; existing stored records default to beer.

Coffee resolves only COFFEE_SLACK_BOT_TOKEN and COFFEE_SLACK_START_GRANT. It never falls back to beer credentials. Start authorization, import, post, retry and asynchronous revalidation all use the record's variant-specific grant. Each app must receive independently generated grants/tokens. Reactions are selected server-side, never supplied by a host command. The frozen result source retains the reaction, so coffee result text and retries retain the correct drink. Mention escaping, private mappings, expiry, revocation and uncertain-delivery behavior are unchanged.

The public theme contains only copy and non-sensitive styling. Local manual rosters, winner-count preferences and existing optional local weights use separate storage namespaces; legacy beer keys are preserved. Live rosters never enter these stores. No identifiable history is introduced. The icon is an original generic vector coffee cup with a PNG export, with no employee/company data.

Automated coverage extends the real Worker/SQLite/alarms suite to both apps: wrong-variant start refusal, invalid creation bodies, immutable variant, opposite-reaction exclusion, selected bot credential, coffee result text, viewer DTO privacy, refresh and disconnected completion. Frontend checks cover isolated local storage and coffee setup/finale/Slack copy. Real Slack workspace activation and acceptance remain pending app installation, secret configuration and deployment.

Final validation: 42 tests pass (29 frontend/domain/controller, 13 Worker/Slack), both typechecks and frontend/Worker production builds pass. No lint task is configured. Diff and dependency review completed; package files unchanged. Changed-file credential/private-data scan found no matches; frontend artifacts contain no server secret names or private Slack mapping fields. Desktop draw/finale and 390px mobile layout were checked with synthetic participants; no horizontal overflow. Real workspace acceptance remains pending activation.

## Reimport identity review — 2026-10-02

Reviewed against SECURITY.md. Switching to manual mode now retains the existing private, session-scoped Slack identity mapping so a later import replaces previous reactors instead of treating them as manual additions. The source is still removed, so manual draws do not post to Slack. The mapping remains server-only and expires with the existing session TTL; authorization, API methods, scopes, DTOs, credentials, logging and dependencies are unchanged. No name-based identity guessing or automatic cleanup of legacy duplicates is performed: after an older version discarded identity information, equal names cannot safely establish that two entries are the same person.

Regression coverage exercises manual switching, manual additions, repeated imports, equal display names, changed display names, removed reactions, stable opaque IDs and absence of Slack IDs from the public DTO.

## Automatic refresh and one-time draw review — 2026-10-02

The user explicitly authorized five-minute refresh and scheduling for the current session, including a final refresh before the automatic draw. Reviewed against every SECURITY.md section. No TTL extension, permanent schedule, employee directory, new credentials, scopes, bindings or dependencies. Browser polling is opt-in, host-only, transient and paused for disconnection, imports, draws and the final two minutes before a schedule. The final check runs server-side regardless of browser polling.

Only an authenticated host can set or cancel the canonical ISO instant, within the existing session lifetime and with time left to finish. Strict command fields, revisions, mutation/draw limits and server validation still apply. The public schedule DTO contains only a timestamp and status; leases, Slack identities and credentials remain private. Time input uses Europe/Amsterdam including DST; nonexistent wall times are rejected. Manual draw/reset consumes the plan. The durable alarm claims the plan before awaiting network I/O, re-reads current state after awaits, revalidates expiry and the variant-specific Slack grant, and invokes the same startDraw mutation after a successful final import. Concurrent host edits/imports are refused while final checking. Retries do not create extra draws or results. Failed/empty/revoked/busy checks are skipped, delayed alarms beyond one minute are skipped, and crashed final checks become skipped after a two-minute lease. The existing session expiry erases all planning state.

The final import has a separate one-per-minute budget so a recent ordinary refresh does not suppress the required last check. It also moves the normal import deadline forward; explicit upstream retry deadlines constrain both paths. This permits at most two imports per minute per session instead of one, with unchanged bounded lookups/timeouts and shared workspace-quota limitations. There is no public final-check API flag. Import errors never trigger a draw from stale participants. Ordinary manual draws retain their existing behavior.

Tests cover Dutch summer/winter time, polling cadence and cancellation, spectator refusal, schema/revision/expiry validation, manual cancellation, common draw selection, duplicate execution, failure/empty/busy outcomes, and real Worker alarms without host polling for both drink variants. Final-check fixtures change reactors after scheduling and verify the new identity is mentioned; failed reads and revoked grants never draw or post. Production activation still requires deploying the backend before the frontend. Existing Slack source/mapping remains temporary and server-only, outputs remain text-safe, and no private data is logged or sent to unrelated services.

Validation for this change: all 49 tests pass (32 frontend/domain/controller, 17 Worker/Slack), both typechecks and both production builds pass. No linter is configured. Desktop and 390px iframe QA verified the refresh checkbox, Friday 15:45 default, plan/cancel controls and no horizontal overflow. Diff review found no new dependencies, secrets, real employee/company fixtures or unsafe VITE variables; frontend bundles contain no private server fields. No production deployment or real Slack post was performed for this change.

Production backend deployed on 2026-10-02 after user approval (Worker version f5501279-329d-4774-89a8-a4bbd052af7b). A temporary manual session with synthetic participants verified scheduled execution and completion on production; the session was deleted afterward. Alarm delivery added several seconds, so scheduling is best-effort rather than exact to the second. No real Slack message was sent. The matching frontend is published by the main-branch Pages workflow.


## User-authorized retention update — 2026-10-02

The user explicitly requested a 24-hour default and extension to a scheduled start plus one hour. This supersedes the earlier eight-hour retention decision; SECURITY.md now records this exact authorization and bounded policy. Existing expiry/authentication/revocation enforcement remains binding. New sessions default to 24 hours, still capped by Slack grant expiry. Only a host setting a future schedule can extend an unexpired session, at most 30 days ahead plus one hour. The operation never shortens existing validity; cancellation/reset keeps the already granted expiry so open viewers are not abruptly invalidated. Expired sessions cannot be revived and ordinary reads never extend retention.

For Slack scheduling, the server rechecks the current variant-specific grant hash and deadline before mutation, including legacy sessions without a stored grant deadline. The full planned time plus one-hour retention must fit that grant; no grant or secret is renewed automatically. The private deadline is excluded from public DTOs. All connected clients receive the updated public session expiry and re-arm their existing expiry timers. New UI no longer disables planning at the old session deadline; it previews the extension and reports a specific insufficient-Slack-access error. No new permissions, dependencies, public environment variables, logging or participant storage are introduced.

Tests cover the explicit 24-hour default, later/earlier replanning, no resurrection, the exact grant ceiling including the extra hour, atomic rejection, legacy-session extension through the real Worker, viewer expiry updates, and the original disabled-button scenario. No real participant data or capability links are used in fixtures.

Retention validation: 53 tests pass (34 frontend/controller, 19 Worker/Slack); both typechecks and both production builds pass. Long-lived browser expiry timers are chunked below the platform timeout limit and tested offline. No configured linting or dependency changes. Changed-file and frontend-bundle checks found no credentials, capability links, private server fields or unsafe VITE configuration.

## External Slack Connect reactors (2026-10-02)

Reviewed against SECURITY.md; it remains unchanged. Slack may return a reduced `users.info` object for external Slack Connect users. Previously the missing `deleted`/`is_bot`/`profile` fields made the whole import fail with `slack_response`. Absent flags now mean false; present flags must still be booleans, the returned ID must still match exactly and a present profile must still be an object. Names keep the existing normalization and `Deelnemer` fallback; no new scopes, API methods, fields, storage or logging. Synthetic tests cover reduced external objects and malformed flags.

## Sign in with Slack replaces start links (2026-10-02)

Explicitly requested by the user, reviewed against every SECURITY.md section; SECURITY.md gains the login rules and no constraint is weakened. Start links could be forwarded and had to be rotated manually; starting now requires a verified Slack identity of a full member of the bot's own workspace.

- **Flow:** OIDC authorization code flow, `openid` scope only. `GET /auth/slack/<variant>` (top-level navigation, before the Origin/query gate) sets a 10-minute `__Host-` cookie (HttpOnly, Secure, SameSite=Lax, no Domain) holding random 256-bit `state` and `nonce` and the variant. The callback rejects missing, duplicate or mismatched state before any Slack call; cancelled logins and replayed or foreign codes fail generically. The cookie is cleared on every outcome.
- **Validation:** the code is exchanged server-side with the client secret in a POST body (never a URL or header). The ID token comes straight from Slack's token endpoint over TLS (OIDC Core 3.1.3.7), so claims are checked without adding a JWT dependency: `iss`, single `aud`, `exp`, timing-safe `nonce`, user ID, and workspace equal to the bot's `auth.test` workspace. `users.info` with the bot token must show a non-deleted, non-bot, non-app, non-guest, non-stranger member of that same workspace.
- **Data:** the user token is revoked immediately (`auth.revoke`, best effort). Nothing about the starter is stored; the session only records a `slack-login` marker and a fixed ceiling of 30 days plus one hour. New API methods: `openid.connect.token`, `auth.test`, `auth.revoke`. New secrets per app: client ID and client secret, Worker secrets only. No new dependencies, VITE variables, browser storage or logging.
- **Redirects:** 303 with `no-store`, `noindex`, `no-referrer` and `default-src 'none'`, so the callback URL with its code never becomes a referrer. Success lands on the host route with capabilities in the fragment only; errors land on `#/slack/<reason>` with a fixed reason set. `FRONTEND_URL` is public configuration and must match an allowed origin.
- **Abuse:** the global per-IP request limit applies to both routes. The start route makes no Slack call, so it cannot spend bot quota; the callback applies the creation limits before any Slack call. A cross-site navigation can at most start a login for the victim's own account; the capabilities stay in the victim's browser.
- **Revocation and limits:** deleting the client secret or bot token disables starts, imports, planning and posts for that app. A single person cannot be revoked after starting; the host link remains bearer access until expiry, as documented. Enterprise Grid across workspaces is not supported. Local real logins need an HTTPS tunnel and a registered redirect URL.
- **Legacy:** `/api/slack-sessions`, the frontend start-link route and the provisioning script are removed. Existing start-link sessions keep validating their grant until it expires, so a scheduled draw started on 2026-10-02 still runs; delete `SLACK_START_GRANT` afterwards.

Tests (synthetic data only) cover cookie attributes and parsing, forged, missing, duplicate and cancelled states, rejected codes, each claim, workspace mismatch, guests, strangers, deleted users, bots and apps, user-token revocation, secrets kept out of URLs, the closed legacy endpoint, legacy grant validation, the fixed login ceiling and the full Worker flow for both variants through Miniflare.

## Legacy start-link grants removed (2026-10-02)

Requested by the user after Sign in with Slack went live; reviewed against SECURITY.md, which now states that start-link grants are no longer accepted. `slackAllowed` and `slackCeiling` only accept the `slack-login` marker with login, bot and client secrets configured; every other stored grant hash fails closed, even if `SLACK_START_GRANT`/`COFFEE_SLACK_START_GRANT` is still set. These secrets are no longer read and can be deleted. Sessions started with a start link keep working manually but lose Slack import, planning, retry and posting. No new permissions, API methods, dependencies, public variables, storage or logging. Synthetic tests cover a legacy hash being refused with a leftover start-grant secret, both directly and through the real Worker.

## Spectator-link reminder before scheduled draws

The user explicitly requested on 2026-10-02 that a scheduled draw posts the spectator link to the Slack thread two minutes ahead. Reviewed against every SECURITY.md section; SECURITY.md now records this exception.

- **Authorization:** only a host mutation can opt in, only in a Slack-linked session with working Slack access. The Worker rejects links whose locator differs from the host's session (400); the Durable Object hashes the offered secret before reading state and only accepts an exact match with the stored spectator hash (403 otherwise). A host link, another session's link, malformed values and free text are refused, so the bot cannot be made to post arbitrary content or URLs.
- **Output:** fixed Dutch text, the start time in Europe/Amsterdam and one rich-text link built from the validated `FRONTEND_URL` (must be an allowed origin, no query/fragment/credentials). The capability stays in the fragment. `unfurl_links`/`unfurl_media` false, `reply_broadcast` false, `link_names` false, no mentions or participant names.
- **Exposure:** everyone who can read the thread, including Slack Connect members, gains view access until session expiry (at most start plus one hour). They already see the reactor list there; the host UI states the consequence and the option can be unchecked.
- **Storage:** the raw spectator capability is stored only inside the pending reminder and deleted when it is posted, uncertain, skipped, finally failed, replaced, cancelled, on draw, reset, manual mode and expiry. It is excluded from host and spectator DTOs; the host status shows only start time and state.
- **Delivery:** claimed and synced before I/O with a two-minute crash lease, rechecks Slack access after the claim, never repeats uncertain posts, one automatic retry after a definite rejection only before the start, and at most five reminder posts per session to bound spam from rescheduling. No new scopes, secrets, bindings, dependencies or logging.

Tests (synthetic data only) cover opt-in, hash/locator/format refusal, missing Slack source, lead time and immediate posting, the 30-second floor, link wiping on every exit path, DTO and storage absence after settling, single delivery under concurrent alarms, message shape for both variants, and rejection followed by cancellation through the real Worker.

## Waterrad review — 2026-10-05

Requested by the user, including sharing the Koffierad Slack app; reviewed against every SECURITY.md section, which now has a Waterrad paragraph. No new dependencies, endpoints, scopes, secrets, capabilities, logging or public participant data. Standalone remains available.

`water` joins the allowlisted variant enum for session creation, the login start route and the login cookie; unknown names are still refused, `/auth/slack/callback` is never treated as a start, and the variant stays immutable. `themes[variant].slackApp` selects the credentials: water resolves only `COFFEE_SLACK_*`, never the beer app, and fails closed like coffee when those are absent. The reaction comes from the server-side theme (`droplet`), never from a client command; the reaction allowlist in the participant source is derived from the same table, and the frozen result source keeps the reaction so retries keep water text. Local rosters and preferences use separate `waterrad.*` keys; live rosters never enter them. The icon is an original generic vector droplet with a PNG export, without employee or company data.

The real Worker/SQLite/alarms Slack suite now also runs for water: start, authorization, DTO privacy, immutable variant, exclusion of `:beers:` and `:coffee:`, the Koffierad bot credential, water result text, refresh and disconnected completion. Frontend tests cover water copy, `:droplet:` and storage isolation.

## Winner mention in the fallback text — 2026-10-06

The owner reported that winners saw a blue mention in the thread result but received no notification. Slack derives mention notifications from the top-level `text`, not from `user` elements in `blocks`, and our fallback carried only escaped names. The thread result (`resultBody`) and the review reply (`reviewBody`) now write the same server-frozen, regex-validated identities as `<@U…>` in the fallback; every other part, including manual names, is still escaped, so `<!channel>`, `<@…>` or links from names cannot become markup. `parse: none`, `link_names: false`, no broadcast or unfurls, unchanged recipients (the frozen `mentionIds` that already rendered as mention elements) and no new scopes, endpoints, data or dependencies. Reviewed against SECURITY.md; it remains unchanged. Review texts stay escaped in the fallback. The settled call (`chat.update`, never notifies) is out of scope.

Tests: unit coverage for the exact mention set in the fallback, an escaped injected manual name, legacy jobs and invalid identities without any `<@`/`<!`, and for the review reply exactly one mention with escaped texts and an escaped manual name; the real Worker suites assert the fallback mention for the Slack winner in both the result and the review reply, and literal text for the manual one. Remaining acceptance check: a real draw in Slack showing the notification.

## "Start met Slack" removed (2026-10-07)

Requested by the owner; reviewed against every SECURITY.md section, which now records the removal. Nothing is weakened: an attack surface disappears.

- **Removed:** the Bierrad login start (`/auth/slack/beer`), plain and `join-…` login cookies, `/auth/slack/join`, `/api/join`, the session join link and personal session links, the host commands `slackImport`, `slackManual`, `slackRetry` and `setReviews`, the `spectatorCapability` field of `setScheduledDraw` and the spectator-link reminder with its stored raw capability, the host Slack DTO, the permalink parser and the frontend Slack controls, auto refresh and join page.
- **Fail closed:** `slackAllowed` accepts only the channel-round grant. Sessions started with Sign in with Slack before this change keep working as plain manual sessions but can no longer read reactions or post. A pending reminder or result job of such a session is never sent. Old `#/slack` and `#/meedoen/…` routes open the local Bierrad and drop the fragment from the address bar.
- **Unchanged:** channel binding, personal channel links, channel rounds, reviews of channel rounds, limits, scopes and secrets. No new dependency, storage, logging or public variable.

Tests: the Worker refuses `/api/join`, every removed host command and a schedule with a spectator link (400); `/auth/slack/beer` never redirects to Slack; login cookies without a channel or member purpose are refused; `slackAllowed` refuses the old login grant.

