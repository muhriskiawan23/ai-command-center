# Tavily Extract — Provider Privacy, Security, and Billing Verification

Status: **NO-GO** for production URL Reader. `URL_READER_ENABLED=false` remains mandatory until evidence and owner approval.

## Verified from public Tavily documentation (2026-11-13)

- Tavily billing FAQ (updated 2026-11-04) says the free Researcher plan includes **1,000 monthly credits**, no credit card required, and **does not charge unless pay-as-you-go is enabled**. This is a general provider claim. Account-specific screenshot evidence is recorded below, but provider billing behavior is not independently tested.
  - https://help.tavily.com/articles/8298987937-billing-credits-usage-limits
- Tavily's privacy policy (updated 2025-11-24) states query data may be used to improve future responses unless otherwise specified by contract, and may be shared with third-party search index providers in limited cases. Retention is purpose-based, not a guaranteed zero-retention or fixed number of days for API URL extraction.
  - https://www.tavily.com/privacy
- BOR AI code blocks URLs with query strings, embedded credentials, private IP literals and unsafe schemes, limits payload size, provider timeout and extraction attempt count. These **do not independently prove** Tavily's provider-side DNS rebinding, redirect, SSRF or final-destination enforcement.

## Owner-provided account billing evidence (2026-11-13)

The owner provided a Tavily Billing > Plan screenshot in the conversation (not committed to the public repository; screenshot must remain private). It visibly showed:

- Personal **Researcher** plan, **1,000 monthly plan credits**, **12 / 1,000 used** at capture.
- **Pay-as-you-go OFF**, **0 pay-as-you-go credits**, and wording that requests stop at the plan limit.
- No upcoming invoice shown, and no credit card required for the free tier.
- Basic Extract: **1 credit per 5 URLs**; Advanced Extract: **2 credits per 5 URLs**, as displayed on the account billing page.
- Pay-as-you-go and Auto upgrade switches appeared off at capture.

**Billing evidence status: PARTIALLY VERIFIED** (account-specific plan and overage toggle at capture). Not independently verified: provider enforcement at exhausted credits, billing of failed/timeout attempts, batch rounding, alert availability, key-specific limits, and any future account setting changes. No new live API requests are authorized. Do not include screenshot, credentials, or payment data in this repository.

## Evidence required before enabling

1. **Billing account**: Owner screenshot confirms plan and pay-as-you-go OFF at capture. Still confirm key-specific limits and billing alerts if available, extraction credit rounding and failure/timeout charging, and whether requests reliably stop when monthly credits exhaust. Never post keys or payment data in GitHub. Provider credit consumption is **not** identical to URL attempt quota.
2. **Security**: Obtain Tavily documentation or written support confirmation covering DNS resolution and re-resolution, private/loopback/link-local/metadata address blocking, redirect hop validation, DNS rebinding and SSRF protections. Do not probe internal or private targets against the live provider.
3. **Privacy**: Confirm API-specific query/URL and retrieved-content retention, processing regions, subprocessors, training/improvement opt-out, deletion mechanism and applicable DPA. Provide a clear user-facing disclosure before third-party URL submission and document consent/legal basis.
4. **Runtime**: Verify deployed Worker feature flag and explicit `TAVILY_EXTRACT_DAILY_URL_LIMIT` through approved deployment controls; ensure the D1 atomic quota works in production. Recheck deployment after merging tests and quota code.
5. **Rollback**: Keep `URL_READER_ENABLED=false` as the immediate rollback mechanism; document operator and monitoring signals. Activation requires explicit owner approval.

## Implemented application controls

- Default extraction attempt allowance is **zero** if daily quota is absent or blank (merged PR #234).
- The atomic D1 daily counter limits *attempted unique URLs* globally, shared across chat and research. Failed provider calls may still consume the attempt quota.
- Mocked /api/chat HTTP tests cover flag OFF, safe URL, sensitive query blocking, and quota exhaustion (merged PR #233).
- These controls **do not enforce a guaranteed USD invoice cap** if Tavily account billing settings permit overages.

## Decision

**NO-GO** until all evidence items are reviewed and documented. Do not activate URL Reader or run additional paid Tavily extraction calls without separate explicit authorization.
