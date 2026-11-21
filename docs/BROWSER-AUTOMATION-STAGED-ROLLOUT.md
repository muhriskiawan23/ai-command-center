# BOR AI Browser Automation — independent delivery track

**Date:** 21 November 2026. **Current scope:** unprovisioned, operator-only staging Worker implementation plus offline tests. No production chat integration. No live browser session, paid inference, external website action, production Cloudflare change, secret, or payment.

## Product boundary

BOR AI should be able to take a user-supplied **safe public website** and, when supported, inspect it, summarize it, navigate it, fill approved forms and complete narrow, explicitly permitted tasks. A link is *not* permission to log in, send information, publish content, purchase, book, pay, or alter third-party data without the user's informed approval. The model must not claim it executed a task until the browser runtime returned verifiable evidence. No tool can guarantee support for every site.

This track is **independent of Tavily**. Tavily Search/Extract and browser automation are distinct providers and billing surfaces. Tavily vendor security answers are not prerequisites for developing and staging the isolated Cloudflare Browser Run implementation; the browser itself has its own independent security/privacy/finance gates.

## Reviewed provider option

Cloudflare **Browser Run** (previously Browser Rendering) offers browser sessions driven by Playwright/Puppeteer/CDP for dynamic sites. Official references:

- https://developers.cloudflare.com/browser-run/get-started/
- https://developers.cloudflare.com/browser-run/playwright/
- https://developers.cloudflare.com/browser-run/features/guardrails/
- https://developers.cloudflare.com/browser-run/limits/
- https://developers.cloudflare.com/browser-run/pricing/

As documented on 21 Nov 2026, Workers Free offers **10 minutes/day** browser usage, a maximum **3 concurrent browsers**, and **one new browser every 20 seconds**. Paid rates/bundles differ. Confirm BOR AI's actual account plan and provider invoice settings before running a live task. This is not an approved production price or estimated customer-credit allocation.

**Important:** Browser Run guardrails must be configured on **every session** with an exact hostname allowlist: `guardrails: { allowedDomains: [hostname] }`. Omitting guardrails permits unrestricted HTTP(S) hostnames. Guardrails alone should not be presented as an independently proven guarantee against redirects, DNS rebinding, special URLs, or arbitrary outbound requests. Cloudflare notes that `outboundByHost` traffic bypasses guardrails: prohibit it in the first release.

## Completed in this PR

- `src/browser-task-policy.js`: deterministic, offline, non-executable plan preview (no model tokens, paid APIs or browser launches).
- Reuses BOR AI's URL validation and adds HTTPS-only, public hostname-only, no query/fragment, and auth/payment-path exclusions.
- Step allowlist: `read_text`, `inspect_links`, `screenshot`; `click` / `fill` can be **previewed only** and always require approval. No arbitrary JavaScript or form submit/purchase/send/delete action is accepted.
- Form values are **redacted** from previews, and output declares `executionEnabled:false`. Default session ceiling for the planned adapter is 30 seconds, one navigation, six steps, 12,000 readable characters.
- `browserExecutionGate` deliberately refuses all **production/chat** browser execution even if feature flags are manually set. A separate, staging-only read-only executor and Worker binding example exist, but are **not provisioned or deployed**.
- Operator-only staging Worker in `staging/browser/worker.js` with a separate D1 migration, per-session exact-host guardrails, request interception, 25-second deadline, browser cleanup, daily reserved-seconds quota, and a one-session lease. Disabled-by-default Wrangler example requires a **new staging D1** and secret provisioned manually.
- Offline unit/Playwright tests for URL/IP/scheme bypasses, internal hosts, query secrets, approval requirements, unsupported actions, no secret echo, auth failures, quotas, redirects, side-effect rejection and bounded content. No paid/browser-provider calls.

## Remaining actionable work (no Tavily email needed)

1. **Staging provisioning and provider proof**: security review, install/pin the nested browser dependency, create a separate staging D1, set a dedicated operator secret and browser binding, deploy disabled by default, and run a narrowly approved live read-only pilot. Verify actual Cloudflare guardrails, egress, session cleanup and metering.
2. **Authenticated user bridge**: add verified customer identity, separate global and per-user credit/billing reservation, and a secure bridge from the main BOR AI Worker only after staging results are independently reviewed. Staging currently supports a single operator pilot, **not** public-user tasks.
3. **Automatic safety policies**: current URL and every redirect must remain on the approved hostname; block private IP/internal metadata and credential-bearing URLs, scripts/downloads/popups/third-party requests where appropriate. Audit Cloudflare guardrails and egress behavior independently; do not confuse hostname validation with DNS pinning.
4. **Permissioned action executor**: propose step plan -> user sees site, proposed selectors, exact action and data-disclosure recipient -> approve -> execute bounded step -> independently verify effect -> report with trace. Sending, posting, purchasing, booking, money movement, irreversible changes and account changes require explicit per-action confirmation, not a blanket "automate" click.
5. **Usage and rollback**: staging has a global daily reserved-seconds cap and single-session lease; production still needs per-user quotas, circuit breakers, no unsafe retries, a kill switch, audit without sensitive DOM/credentials, cancel button, and transparent user credit pricing after measured provider costs.
6. **Browser benchmark**: static, JS-rendered, failed/redirected, unsafe, login, CAPTCHA and cross-origin fixtures on a safe test site. Staging smoke requires review of real billing, session cleanup, provider data handling, and live error messages before any production activation.

## Release gates

- GitHub CI green for **exact commit** (unit + syntax + preview + browser E2E).
- No direct production deployment or release from this PR. Production still advertises general browser interaction as **unavailable**.
- Reviewer approves Cloudflare account permission, domain restrictions, user consent model, actual free/paid limits and incident rollback.
- A controlled staging session is successfully run with real browser evidence, no unauthorized external writes, and reconciled zero/known cost.
- Separate approved PR is required before wiring `/api/chat`, activating the browser binding, enabling web actions in Plugins or consuming customer credits.

**Related:** #273 (product objective), #156 (separate URL Reader/egress security issue), PR #343 (truthful Search/Reader/Action UI).
