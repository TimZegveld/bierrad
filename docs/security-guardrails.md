<!-- Vastgelegd als projectcontext op verzoek van de gebruiker. Historische briefing. De geldende implementatieregels staan nu in SECURITY.md en AGENTS.md; de Live Session-review staat in docs/live-security-review.md. -->

# Bierrad — Establish Security, Privacy and Agent Guardrails

We need to establish mandatory security and privacy rules for the Bierrad project before implementing Slack integration, live sessions, WebSockets or Cloudflare infrastructure.

The Bierrad source repository will be PUBLIC and the frontend will be deployed through GitHub Pages.

Future versions will likely use:

- Slack API
- Cloudflare Workers
- Cloudflare Durable Objects
- WebSockets
- live synchronized sessions
- scheduled automatic draws

Future Slack integration will process real employee display names.

Therefore we must clearly separate:

1. public application code;
2. private credentials;
3. temporary session data containing employee names;
4. privileged host capabilities;
5. read-only spectator capabilities.

This iteration is about SECURITY DOCUMENTATION, ARCHITECTURAL GUARDRAILS and AUDITING THE CURRENT PROJECT.

Do NOT implement Slack, Cloudflare, WebSockets, authentication or live sessions yet.

---

# BEFORE MAKING CHANGES

Inspect the current repository.

Read:

- VISION.md
- README.md
- package configuration
- source code
- tests
- .gitignore
- GitHub Actions/workflows if present
- existing environment variable usage

Search the repository for:

- secrets
- API keys
- tokens
- webhook URLs
- Slack identifiers
- employee information
- private company information
- unsafe environment variables
- unsafe browser storage
- unsafe HTML rendering

If you discover something that appears to be an actual credential:

DO NOT print its value.

Only report:

- location
- credential type
- whether it appears tracked
- required remediation

---

# 1. CREATE SECURITY.md

Create a root-level:

SECURITY.md

Everything in this document is a MANDATORY implementation constraint.

It applies to:

- frontend
- GitHub Pages
- backend
- Slack integration
- Cloudflare
- WebSockets
- Durable Objects
- scheduling
- tests
- CI/CD
- local development

Security requirements take precedence over convenience.

---

# 2. CORE TRUST MODEL

Document the following trust model.

## PUBLIC / UNTRUSTED

Always assume the following are completely public:

- GitHub repository
- Git history
- GitHub Pages deployment
- frontend source code
- compiled JavaScript
- source maps
- browser localStorage
- browser sessionStorage
- browser IndexedDB
- browser network traffic
- API URLs
- WebSocket URLs
- frontend environment variables
- anything using VITE_*

Never depend on obscurity of frontend code for security.

Browsers and WebSocket clients must be treated as untrusted clients.

---

# 3. PRIVATE / TRUSTED

Sensitive operations belong behind the server-side security boundary.

The intended future architecture is:

PUBLIC

GitHub Pages
React frontend
      |
      | HTTPS / WSS
      v

=====`======= SECURITY BOUNDARY =======`=====

      |
      v

Cloudflare Worker
      |
      +---- Durable Objects
      |
      +---- Slack API
      |
      +---- scheduled operations
      |
      +---- privileged session state

PRIVATE / SERVER SIDE

The frontend must never possess credentials required to perform privileged operations.

---

# 4. SECRETS

The following must NEVER enter frontend code:

- Slack Bot Tokens
- Slack User Tokens
- Slack App Tokens
- Slack Signing Secrets
- OAuth client secrets
- private API keys
- backend API secrets
- Cloudflare credentials
- webhook secrets
- private authentication keys
- service account credentials
- database credentials
- encryption keys

They must also never be committed in:

- source code
- .env files
- tests
- fixtures
- examples
- documentation
- comments
- build output

Server-side secrets must eventually be stored using Cloudflare Secrets or an equivalent secure secret-management system.

---

# 5. VITE ENVIRONMENT VARIABLES

Explicitly document:

EVERY environment variable prefixed with:

VITE_

must be considered PUBLIC.

Allowed:

VITE_API_URL
VITE_WEBSOCKET_URL

Forbidden:

VITE_SLACK_TOKEN
VITE_SLACK_SIGNING_SECRET
VITE_API_SECRET
VITE_PRIVATE_KEY

Never solve a secret-management problem using a VITE_ variable.

---

# 6. SLACK SECURITY BOUNDARY

Future Slack integration must use:

Browser
   |
   | HTTPS
   v
Bierrad Backend
   |
   | server-side Slack credentials
   v
Slack API

Never:

Browser
   |
   | Slack credential
   v
Slack API

The browser must NEVER receive a Slack credential.

Slack permissions must follow least privilege.

Every Slack scope must have a documented reason.

Do not request broad workspace permissions merely because they simplify development.

---

# 7. EMPLOYEE DATA / SLACK NAMES

Employee display names retrieved from Slack are not secrets in the same sense as credentials, but they are private application/session data and must NOT be exposed unnecessarily.

The public GitHub Pages application must NOT contain a static or globally accessible list of employee names.

Employee information must only be returned after valid access to a temporary Bierrad session.

Do not commit real:

- employee names
- employee email addresses
- Slack user IDs
- Slack messages
- Slack channel IDs
- Slack workspace IDs
- private channel names
- internal URLs
- internal webhook URLs
- confidential company information

Use synthetic development/test data such as:

Alice
Bob
Charlie

U_TEST_001
U_TEST_002
C_TEST_001

---

# 8. DATA MINIMIZATION

Only retrieve and expose data required by Bierrad.

For a participant this will normally mean:

SERVER SIDE:

- Slack user ID
- display name
- optionally avatar URL

CLIENT SIDE:

Prefer:

- session-scoped participant ID
- display name
- optionally avatar URL

Do NOT expose the original Slack user ID to spectator browsers unless there is a concrete requirement.

Example:

Server knows:

Slack U04ABC123 -> Tim

Browser receives:

p_9ae71 -> Tim

This keeps Slack-specific identifiers behind the backend boundary.

Do not retrieve unrelated Slack profile information merely because the API exposes it.

---

# 9. BIERRAD SESSIONS

Future live Bierrad functionality must use temporary sessions.

There must NOT be one globally accessible endpoint containing the current employee participant list.

Bad:

/live
/api/current-participants

Instead, each draw/session receives a cryptographically secure, non-enumerable capability.

Conceptually:

/live/<spectator-capability>

and:

/host/<host-capability>

Session identifiers/capabilities must NOT be:

- sequential
- predictable
- dates
- timestamps
- Slack channel IDs
- Slack message IDs
- employee names
- team names

Do not use identifiers such as:

/live/1
/live/2
/live/2026-09-25
/live/C0123456
/live/tim-jan-peter

Use cryptographically secure high-entropy random values.

Do NOT use Math.random() to generate security-sensitive session capabilities.

---

# 10. CAPABILITY URL SECURITY MODEL

Document that an unguessable URL is a capability URL.

It protects against enumeration and casual discovery.

However:

A capability URL is NOT equivalent to full user authentication.

Anyone who obtains the complete URL may potentially use that capability until it expires or is revoked.

Therefore capability URLs must be:

- high entropy
- cryptographically generated
- temporary
- scoped to specific permissions
- revocable where practical

Do not describe an unguessable URL as making data "private" in an absolute sense.

---

# 11. HOST AND SPECTATOR MUST BE SEPARATE

Do NOT use one capability for both watching and controlling a session.

A session should conceptually have separate capabilities:

BeerWheelSession
├── internalSessionId
├── spectatorCapability
└── hostCapability

The spectator capability may allow:

- viewing participants
- viewing the wheel
- receiving live draw state
- receiving winners

The spectator capability must NOT allow:

- changing participants
- refreshing participants from Slack
- starting a draw
- resetting a draw
- changing winner count
- changing schedule
- posting to Slack
- modifying session configuration

The host capability may authorize these operations as appropriate.

---

# 12. SERVER-SIDE AUTHORIZATION

Frontend controls are UX.

They are NOT security.

Hiding the "DRAAI" button from spectators does not prevent a malicious spectator from manually calling an API.

Every privileged backend operation must verify authorization server-side.

For example:

POST /session/.../draw

must verify that the requester has host capability.

The server must reject the same operation when called with spectator capability.

This also applies to WebSocket messages.

---

# 13. CAPABILITY STORAGE / TRANSPORT

Treat host and spectator capabilities as sensitive temporary values.

Avoid leaking them unnecessarily through:

- logs
- analytics
- error messages
- referrer headers
- screenshots/debug output
- third-party scripts

When the live-session feature is implemented, evaluate appropriate browser and HTTP controls, including:

- Referrer-Policy
- Cache-Control
- Content-Security-Policy
- third-party resource usage

The application should avoid sending capability-bearing URLs to unrelated third-party services.

Do not add third-party analytics to private session pages without a security/privacy review.

---

# 14. SESSION EXPIRATION

Sessions containing employee names must expire automatically.

Do not retain live participant data indefinitely.

Design future sessions with a TTL.

Initial recommended default:

8 hours

The exact duration may become configurable later.

After expiration:

- spectator capability stops working
- host capability stops working
- participant data is no longer returned
- active WebSocket connections are closed or invalidated
- session state should be eligible for deletion

The UI should show a generic message such as:

"Dit Bierrad is afgelopen."

Do not expose old participant data after expiration.

---

# 15. SESSION DATA PERSISTENCE

Prefer ephemeral/session-scoped storage.

Do not create a permanent employee directory.

Do not persist Slack participant data beyond what is needed for the active session unless a future product requirement explicitly requires it.

Historical statistics must not silently become permanent employee tracking.

Any future persistent history involving identifiable employees requires a separate privacy/security review.

---

# 16. WEBSOCKET SECURITY

Future WebSocket connections must authenticate/authorize against the session capability.

Knowing the WebSocket endpoint itself must not provide access to participant data.

Example:

wss://api.example/.../<spectator-capability>

Before sending session state, the backend must verify that the capability is:

- valid
- associated with the requested session
- not expired
- authorized for spectator access

Privileged WebSocket messages must require host authorization.

Clients are untrusted.

Never accept an official winner or DrawInstruction simply because a browser sent one.

---

# 17. SERVER AUTHORITY

Future live sessions must treat the server as authoritative for:

- participant state
- session state
- DrawInstruction
- official winners
- scheduled start time
- Slack posting
- privileged configuration

Clients render official state.

Clients do not decide official state.

A malicious client must not be able to declare itself a winner.

---

# 18. INPUT VALIDATION

Treat all external input as untrusted.

Including:

- participant names
- Slack message URLs
- Slack API responses
- URL parameters
- capability tokens
- session IDs
- WebSocket messages
- API request bodies

Validate inputs at appropriate trust boundaries.

Frontend validation is not sufficient for privileged operations.

---

# 19. OUTPUT SAFETY

Slack-provided names and other external strings must be treated as untrusted text.

Use normal React rendering.

Do not render participant or Slack data using:

dangerouslySetInnerHTML

Do not introduce unsafe HTML injection.

---

# 20. BROWSER STORAGE

Never store credentials in:

- localStorage
- sessionStorage
- IndexedDB
- JavaScript-accessible cookies

localStorage may contain non-sensitive preferences such as:

- manually entered participants
- preferred number of wheels
- sound preference
- UI preferences

When Slack/live mode is introduced, do not automatically persist Slack participant lists into localStorage.

---

# 21. CACHE / INDEXING / DISCOVERY

Future session endpoints containing employee information must not be designed as publicly indexable resources.

When implemented, private session responses/pages should use appropriate measures such as:

- noindex where applicable
- restrictive caching
- no public directory/listing of active sessions

There must never be an API such as:

GET /sessions

that lets an unauthenticated public client enumerate active private sessions.

---

# 22. CORS

Future backend APIs must have an intentional CORS policy.

Do not blindly configure:

Access-Control-Allow-Origin: *

for privileged operations.

CORS is not a replacement for authorization.

---

# 23. RATE LIMITING / ABUSE PROTECTION

Future endpoints capable of:

- calling Slack
- refreshing participants
- posting Slack messages
- starting draws
- creating sessions
- modifying sessions

must have appropriate abuse protection.

Do not allow arbitrary internet clients to generate unlimited Slack API calls.

---

# 24. LOGGING

Never log:

- Slack tokens
- capability tokens
- authorization headers
- signing secrets
- OAuth secrets
- environment dumps containing credentials

Be careful with logging complete URLs because future URLs may contain capability tokens.

Prefer redacted session identifiers for diagnostics.

Minimize employee information in logs.

---

# 25. ERROR HANDLING

Client-facing errors must not expose:

- credentials
- capability values
- backend environment variables
- sensitive configuration
- internal authentication details
- unnecessary stack traces

Prefer generic client errors with detailed server-side diagnostics where appropriate.

---

# 26. GIT SECURITY

Secrets must never be committed.

Ensure .gitignore appropriately includes:

.env
.env.local
.env.*.local
.dev.vars

Do NOT ignore:

.env.example

Example environment files may contain placeholders only.

Never real credentials.

---

# 27. GIT HISTORY

Deleting a secret from the latest source does NOT make the secret safe.

If a real secret is ever committed:

1. treat it as compromised;
2. revoke/rotate it immediately;
3. remove it from repository history where appropriate;
4. investigate where else it may have been exposed.

Never continue using the same exposed credential merely because the source line was deleted.

---

# 28. GITHUB ACTIONS / GITHUB PAGES

GitHub Actions must never inject private backend secrets into a GitHub Pages frontend build.

Anything included in the frontend build must be considered public.

GitHub Pages should contain only:

- application code
- public configuration
- public API endpoint addresses

Never:

- Slack credentials
- capability-generation secrets
- Cloudflare credentials
- signing keys

---

# 29. DEPENDENCIES

Keep dependencies minimal.

Before adding a dependency:

- determine whether it is necessary
- prefer maintained packages
- avoid suspicious or abandoned packages
- avoid dependencies for trivial functionality

Do not send participant/session information to third-party services without a clear requirement and security/privacy review.

---

# 30. SECURITY GOLDEN RULE

End SECURITY.md prominently with:

> Assume GitHub, GitHub Pages and every browser are completely public and untrusted.
>
> Credentials and privileged operations belong behind the server-side security boundary.
>
> Employee data is only exposed to authorized temporary sessions, using high-entropy, scoped, expiring capabilities.

---

# 31. CREATE AGENTS.md

Create a root-level:

AGENTS.md

This contains binding instructions for Codex and future coding agents.

Require every agent to read before implementing changes:

1. AGENTS.md
2. VISION.md
3. SECURITY.md
4. relevant README sections
5. relevant source code
6. relevant tests

State explicitly:

SECURITY.md is a binding implementation constraint.

If a requested implementation conflicts with SECURITY.md:

- DO NOT weaken security
- DO NOT expose credentials for convenience
- DO NOT silently bypass the requirement
- choose a secure architecture instead

If secure implementation requires server-side infrastructure that does not exist yet:

STOP that portion of implementation and explain which server-side component is required.

Do not implement an insecure temporary workaround.

---

# 32. AGENT SECURITY REVIEW

Add to AGENTS.md that changes involving:

- Slack
- APIs
- WebSockets
- Cloudflare
- Durable Objects
- environment variables
- session capabilities
- employee data
- authentication
- authorization
- GitHub Actions
- external integrations

require an explicit security review against SECURITY.md.

---

# 33. AGENT DEFINITION OF DONE

Before completing future implementation work, require:

1. run tests
2. run TypeScript/type checking
3. run linting if configured
4. run production build
5. inspect git diff
6. check for accidental secrets
7. check for private company information
8. check for real employee data
9. check for unsafe VITE_ variables
10. verify SECURITY.md remains satisfied

---

# 34. REVIEW CURRENT PROJECT

After creating SECURITY.md and AGENTS.md, audit the current project.

Check at minimum:

- tracked .env files
- .gitignore
- Vite environment variables
- hardcoded tokens
- API keys
- Slack IDs
- employee information
- company information
- webhook URLs
- browser storage
- dangerouslySetInnerHTML
- GitHub Actions
- frontend assumptions about secrets
- unnecessary dependencies
- build configuration

Fix straightforward violations when this can be done without changing product behavior.

Do not perform speculative large refactors.

---

# 35. UPDATE .gitignore

Review .gitignore.

Ensure appropriate local secret files are ignored.

At minimum consider:

.env
.env.local
.env.*.local
.dev.vars

Preserve existing useful ignore rules.

---

# 36. OPTIONAL .env.example

If useful, create:

.env.example

It may contain only:

- public frontend configuration
- obvious placeholders

For example:

# PUBLIC - visible in frontend
VITE_API_URL=https://example.invalid
VITE_WEBSOCKET_URL=wss://example.invalid

Do NOT add examples such as:

VITE_SLACK_TOKEN

because Slack credentials must never conceptually belong in Vite.

If future server secrets are documented, clearly mark them:

SERVER ONLY

and use placeholders.

---

# 37. UPDATE README.md

Add a concise security architecture section.

Do not duplicate SECURITY.md.

Explain that:

- GitHub repository is public
- GitHub Pages contains only public/unprivileged frontend code
- Slack access happens server-side
- live Slack participant names are exposed only through temporary sessions
- sessions use separate host/spectator capabilities
- capabilities are cryptographically random and expire
- credentials never enter the browser
- SECURITY.md contains the mandatory detailed requirements

---

# 38. UPDATE VISION.md IF NEEDED

Do not turn VISION.md into security documentation.

But ensure the future Live Bierrad vision is compatible with:

- temporary sessions
- host mode
- spectator mode
- synchronized wheels
- scheduled draws
- Slack participant loading
- session expiration

The product vision may describe:

/host/<private-capability>

/live/<spectator-capability>

conceptually.

Do not expose implementation secrets.

---

# 39. DO NOT IMPLEMENT YET

This task must NOT implement:

- Slack integration
- Cloudflare Worker
- Durable Objects
- WebSockets
- login/authentication
- session backend
- scheduled draws
- capability generation

We are defining the architecture and guardrails before those features are implemented.

Existing Bierrad functionality must continue working.

---

# 40. VALIDATION

After making changes:

- run tests
- run type checking
- run linting if configured
- run production build
- review git diff
- search for likely credentials
- perform the SECURITY.md checklist

Never print discovered secret values.

---

# 41. FINAL REPORT

Provide a concise final report.

Include:

## Created

List files such as:

- SECURITY.md
- AGENTS.md

## Changed

For example:

- README.md
- VISION.md
- .gitignore
- .env.example

## Current security audit

Report whether you found:

- exposed secrets
- suspicious credentials
- private company information
- employee data
- unsafe Vite variables
- unsafe browser storage
- unsafe HTML rendering
- GitHub Pages build concerns

Do not reproduce sensitive values.

## Validation

Report:

- tests
- type checking
- lint
- production build

## Architecture confirmation

Explicitly evaluate whether the project now follows:

PUBLIC / UNTRUSTED

GitHub repository
GitHub Pages
browser
frontend code
public API/WSS addresses

             |
             v

`======= SECURITY BOUNDARY =======`

             |
             v

PRIVATE / TRUSTED

Cloudflare backend
Slack credentials
Slack identifiers where possible
session authority
capability validation
privileged operations

             |
             v

TEMPORARY AUTHORIZED EXPOSURE

/live/<spectator-capability>
      |
      +-- session-scoped participant IDs
      +-- display names
      +-- current wheel state
      +-- current winners

If the current project violates this boundary anywhere, report it rather than hiding or bypassing the issue.