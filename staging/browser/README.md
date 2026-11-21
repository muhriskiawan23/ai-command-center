# BOR AI Browser Run staging — deployment hold

**Not deployed.** This directory is a separate, **operator-only and read-only** staging Worker, not a feature of production BOR AI chat. It does not use Tavily. It is not activated by PR merge, passing CI, or adding a browser binding.

## Implemented

- Cloudflare Playwright browser binding BOR_BROWSER with **per-session exact-host guardrails**.
- An additional browser-request gate permits only GET/HEAD over HTTPS for the configured pilot hostname and blocks URL queries/fragments and sensitive login/payment paths. Cloudflare guardrails are a provider control, **not independently validated peer-IP/TLS pinning**.
- Only POST /api/browser/read exists. It requires a 32+ character **staging-only** operator bearer secret and an exact, preconfigured hostname.
- One browser session at a time through an isolated D1 lease expiring after 40 seconds; quota reservations are atomic in D1 and are not refunded after possible billable browser attempts. Defaults are **zero/disabled**, maximum allowed request reservation 30 seconds and maximum staging daily budget 120 seconds. The pilot example uses 30 seconds per request and suggests at most 60 seconds/day. Browser operations share one 25-second deadline; best-effort session/context cleanup is bounded.
- Only rendered **read-only** text, same-host links and metadata are returned; 12k text characters and 20 links maximum. Arbitrary JS execution, login, clicks, form-filling, sending, purchasing, downloads, screenshots, PDFs and session persistence are **not available through this endpoint**.
- No user credentials or session cookies are passed in. Fetched page text remains untrusted evidence, not instructions for the AI.

## Before a real pilot (manual owner review required)

1. Review Cloudflare **Browser Run** privacy/traffic safeguards, guardrail behavior (especially redirects, WebSocket, service workers, DNS/SSRF and outboundByHost), terms, quota and the actual BOR AI account's plan. Require a controlled public pilot hostname.
2. Create a **NEW staging-only** Cloudflare D1 database, e.g. bor-ai-browser-staging; never use bor-ai-chat, bor-ai-billing-staging, or any live payment/credit database. Apply only migrations/0001_browser_staging_budget.sql to this new DB.
3. Copy wrangler.example.jsonc to wrangler.jsonc under this folder (keep the example file unchanged), fill the new D1 UUID and name, set STAGING_BROWSER_PILOT_HOST to the exact vetted public DNS hostname, and set approved per-day/per-request quotas. Keep STAGING_BROWSER_ENABLED=false initially. Ensure no accidental route to a production domain.
4. Install dependencies in this **nested staging-only** project (npm install here), pin and commit its generated lockfile before release. Use Wrangler 4. The production root package must not be changed implicitly.
5. Supply STAGING_BROWSER_OPERATOR_TOKEN as a Cloudflare secret, 32+ unguessable characters, only after reviewing how Wrangler secret writes can create new Worker versions. Never place it in .jsonc, GitHub, logs, URLs or client-side JavaScript.
6. Perform an independent security review and dry-run build, verify the exact Worker name and bindings, then approve a **separate** staging deployment with feature still disabled. Only then explicitly approve the first paid-metered Browser Run test and change the staging enable flag. Test one vetted public site without login/query tokens; verify guardrails, browser closure, D1 counters and Cloudflare metering.
7. Never expose the operator token to BOR AI public users. Future user-facing sessions require verified Google session identity, per-user quotas, confirmation and a separate feature review.

## Example staging API (only AFTER approval and enablement)

POST /api/browser/read
Header: Authorization: Bearer <staging-only-operator-secret>
Header: Content-Type: application/json
Body: {"url":"https://example.com/"}

The endpoint never executes arbitrary commands supplied in JSON; the only accepted key is url. A successful response reports whether page text was **actually read**, and a failure returns a short code without raw third-party exception text. No CORS policy is configured for browsers.

## Local CI checks

Root node --test runs tests/browser-staging-*.test.js with stub D1 and stub browser launches, with **no real Cloudflare calls**. The nested staging Playwright dependency is not required for these offline tests. The separate staging Worker build with the real Cloudflare package and D1 binding still requires an approved environment and is **not proven deployable solely by main-repository CI**.

References: [Cloudflare Playwright](https://developers.cloudflare.com/browser-run/playwright/), [Browser Run guardrails](https://developers.cloudflare.com/browser-run/features/guardrails/), [Limits](https://developers.cloudflare.com/browser-run/limits/), [Pricing](https://developers.cloudflare.com/browser-run/pricing/).

This is intentionally independent from Tavily Extract, issue #156 and PR #343. Do not merge it into a production release pipeline without review.
