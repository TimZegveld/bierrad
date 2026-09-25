# Agent instructions

Before changing this project read this file, `vision.md`, `SECURITY.md`, relevant README sections, source and tests. SECURITY.md is binding. Never weaken it or expose credentials for convenience. Choose secure server-side architecture; if a necessary backend component cannot be supplied, stop that portion and explain what is missing instead of adding an insecure workaround.

Preserve standalone use and the warm Dutch Bierrad experience. Wheel rendering must remain deterministic and independent of networking and winner selection. Slack and automatic scheduling are out of scope until explicitly requested.

Changes involving APIs, WebSockets, Cloudflare, Durable Objects, environments, capabilities, employee data, authorization, integrations or GitHub Actions require an explicit SECURITY.md review. Before completion run tests, frontend/backend type checks, configured linting and production builds; inspect the diff and dependencies; check for secrets, private company information, real employee data and unsafe VITE variables. Report concrete limitations honestly without printing secrets.
