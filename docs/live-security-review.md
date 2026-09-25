# Live Sessions security review — 2026-09-25

Implementation review against SECURITY.md, not an independent security audit or a guarantee against all attacks.

## Boundary and authorization

- Static Pages contains public configuration only. Local mode needs no Worker.
- One Worker routes to one SQLite Durable Object per random session locator. Locator and internal session ID grant no access. There is no listing API.
- Host and spectator have independent 256-bit random secrets from Web Crypto. SHA-256 hashes are stored; comparisons are timing-safe. No signing/generation secret is needed.
- HTTP uses `Authorization: Bearer`; WebSocket upgrade uses an `auth.` subprotocol offer, never echoed. The selected protocol is only `bierrad`. Socket attachments contain role and flood counters, not credentials or names.
- Every HTTP request authenticates and checks expiry. Sockets authenticate before any snapshot, and every incoming message and broadcast checks expiry. Host commands are checked on the server. WebSockets accept only a bounded ping: mutation messages are rejected for every role. HTTP is the only mutation transport.
- Strict command shapes prevent injected winners/DrawInstructions and unexpected properties. Names are normalized, unique ignoring Dutch case, maximum 32 characters, maximum 100 participants. Request streams are bounded to 16 KiB. Revisions reject stale concurrent edits.
- Winner selection reuses the unbiased secure draw engine on the server. Two-second lead-in and alarms determine start/reveals/completion without browsers reporting completion.

## Data and credentials

- Safe DTO allowlists participants (session-generated ID/name), count, state, revealed IDs, complete draw, expiry and revision. It excludes internal session ID, capability hashes and private counters.
- Eight-hour TTL is checked even if an alarm is delayed. Expiry/end closes sockets, sends a generic unavailable message and deletes application storage with `deleteAll`. Provider backup/recovery retention is governed by Cloudflare; no immediate physical erasure claim is made.
- The frontend clears roster/results on expiry/unavailable, including an offline expiry timer. No live roster or capability is written to localStorage/sessionStorage/IndexedDB. Local manual data remains a separate source.
- Capability links use fragments, which are not sent to Pages. Host links retain the host and spectator capabilities in the fragment to permit reload and re-copy; spectator links contain only spectator access. Links may remain in browser history or an intentionally shared clipboard. Anyone possessing them has the indicated rights until expiry/end. Share only the **Kopieer kijklink** result, not the host address.
- No application logs of names, authorization values, request bodies, credential-bearing URLs or errors with stacks. Worker observability is explicitly disabled to avoid automatic sensitive header tracing. Operators must not enable raw header/body logging or third-party tracing without redaction/review. Development tools/browser inspectors can see credentials; never export these traces or screenshots with URLs. Test sessions use synthetic data and are terminated after review.
- Meta `no-referrer` and `noindex` apply to the frontend; private API responses additionally use `no-store, private`, noindex headers, no-referrer, nosniff and a restrictive API CSP. Pages cannot set per-fragment HTTP headers, and fragment routes share one static document. Existing optional Google Fonts receive no referrer and no session data; no analytics is added. A frontend CSP restricts scripts/resources and connects only to the configured backend plus local development HMR.

## Abuse controls and limitations

- Creation: 5/minute per connecting IP, 60/minute per Cloudflare location across callers. Other HTTP/upgrade requests: 240/minute per connecting IP. Counters use platform rate-limit bindings before creating/routing a DO.
- Within a session: 60 successful mutations/minute and 6 draws/minute, stored with the session; 64 active sockets; 12 messages/minute per socket and 256-character messages. Participant/body bounds constrain broadcast size.
- Edge limits are approximate and per location, not a global spend cap or bot identity system. Distributed attackers can still create workload; shared office IPs may hit limits. No account system or CAPTCHA is claimed. Stronger creation authorization can be inserted at the Worker creation branch. Review Cloudflare billing alerts/budgets before wider promotion. Rate-limit namespace numbers must be unique to this app within the account.
- Capability access is bearer authorization, not proof of employee identity. End-session revokes both roles; individual participant history, selective credential rotation and accounts are not implemented.
- CORS/Origin is an exact allowlist (production GitHub Pages origin, development loopback origins), checked for HTTP and WebSocket upgrades. Scripts can forge Origin; capabilities remain mandatory.
- Authorized clients receive predetermined winners in DrawInstruction before visual reveal, so a technical spectator can inspect the result early. This is inherent to the requested deterministic client animation model, not a secret drawn after animation.

## Verification

- Existing sampling, timing, renderer, capabilities and local-storage regression tests pass.
- Remote-controller tests cover clock skew, no client random selection/storage, stale revisions, reconnect with backoff, role denial and clearing unavailable state.
- Actual workerd/SQLite/WebSocket integration covers creation, invalid/missing access, Origin rejection, every spectator mutation, injected socket commands, broadcasts to three clients, future shared draw, late join, completion with host disconnected, reset broadcast, expiration of both roles, storage deletion and creation throttling.
- Domain tests cover duplicate/oversized names, count bounds, stable session IDs, unsupported winner injection, locks, independent repeated draws and exact target alignment. Production contains no test-only expiry interface.
- Browser acceptance: host adds eight synthetic participants, two spectators update, three wheels show on all screens, same winners appear, refresh restores result and another spectator joins mid-animation. Measured adjusted animation progress was within about 70 ms in local browser documents. Real internet latency/background throttling can increase skew.
- Dependency audit reported zero known vulnerabilities at review time. Searches checked source/config/build for likely secrets, unsafe Vite names, private endpoints and unsafe HTML rendering. The only unsafe-HTML-pattern hit in the built JS was React internals, not application usage. No real employee dataset or company data was added. Examples and acceptance inputs are synthetic.

All six requested security answers are **No**: public Pages URL alone cannot retrieve names; spectator credentials cannot mutate; browsers cannot supply official winners; public APIs cannot enumerate sessions; expired credentials cannot retrieve names; frontend builds contain no privileged backend credentials.

## Slack extension

The original live-session review above remains applicable. Optional Slack access and its separate organizer grant, imports, posting and delivery limitations are reviewed in [slack-security-review.md](slack-security-review.md). Ordinary public session creation still grants no Slack access.
