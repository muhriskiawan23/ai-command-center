# BOR AI Web Search V2 — staging alignment and release hardening

Date: 26 November 2026 WIB. Base: 64dfc38fdbcdb15008657dce73beb51245a894fa. No production deployment, no Tavily removal, no new API keys, no permission changes, no deposit, no GitHub Actions requested or dispatched.

## Staging configuration evidence

- `bor-ai-luna-staging` version 26 (`df3cb51e-8ac6-4a10-8be4-ff75d419485e`) receives 100% traffic; deployment `42ef856b-72fc-42a5-9b7d-58044bf3a635`. Rollback version 18 (`0ba64284-7281-4f31-a743-9896afc58c29`). Version 26 inherited the known-good version 25 key into both `BOR_TEXT_BACKUP_API_KEY` and `BOR_WEB_SEARCH_OPENAI_KEY` via Cloudflare version inheritance. No credential value was read or logged.
- Search mode off, kill switch true, both staging smoke flags false, temporary evaluation bindings absent, zero cron schedules. Staging D1 remains isolated. Production version `c6dcf354-46c3-4772-9521-55f97cb2fb78` retains 100% traffic.
- D1 read-only ledger: 9 requests, 228420 micro-USD search usage. Previous checked-in evaluation evidence totals 228947 micro-USD including router. Use the larger figure against campaign ceiling 500000; remaining 271053 micro-USD. No additional provider requests in this session.

## Code hardening

- The normal Luna search now shares the evaluated request settings: 2000 output tokens, two requested tool calls, Standard tier, low reasoning, 40-second per-request timeout. Global search timeout 50 seconds, also subject to caller cancellation. Optional organization and project headers must both be valid or the OpenAI provider is not admitted.
- The staging smoke uses the dedicated search secret rather than silently mapping the text key. The evaluation uses the shared search request settings. A 260000 micro-USD conservative Luna reservation floor accounts for long context, tool calls and output; insufficient configured reservation disables Luna search. This is application admission control, not a provider-enforced hard spending cap. Real tool-item count and charges must still be reconciled. Do not run the six-case campaign again: router reservation plus search reservation exceeds the remaining campaign headroom.
- For strict city-only job searches, reject answers containing no stable individual vacancy ID in a cited path or multiple distinct vacancy IDs; bounded retry/fallback still requires a new reservation. This is a structural guard, not proof of official employer identity, current vacancy availability, physical address or semantic claim-to-source alignment. Query-only job IDs are deliberately not accepted because saved history strips query strings. Credential-like query parameters and token fragments are not rendered as clickable citations.

## Offline regression evidence

9/9 targeted regressions passed against the patched JavaScript module in an isolated V8 runtime with synthetic HTTP response, URL validator, D1 admission, and cancellation interfaces. No network or paid AI calls. The real Node test file is included for later execution with native interfaces; full Node suite, native D1/URL integration and browser E2E were not rerun. Previous six live scenarios remain historical evidence, not proof of the new revision.

- PASS: strict city search rejects a collection-only answer
- PASS: a second reserved angle can replace a list-only response with one detail citation
- PASS: multiple distinct vacancy IDs are not accepted for one strict city example
- PASS: pagination and query-only identifiers do not qualify as stable individual vacancies
- PASS: credential-bearing citations are dropped before being rendered
- PASS: eligible Google fallback also rejects collection-only strict city results
- PASS: Luna search refuses an underfunded reservation before any provider call
- PASS: Luna normal request uses evaluated model settings and explicit project routing
- PASS: partial or malformed explicit organization routing fails closed

## Release blockers and next gates

- The source changes in this checkpoint have not been bundled/deployed to staging version 26. Validate native Node tests, build and isolated end-to-end staging chat with the actual dedicated binding and project routing. Do not re-run already-passed scenarios unnecessarily. Current remaining campaign budget cannot conservatively admit a full additional router plus Luna search using the prior router reservation. Do not authorize additional spend automatically.
- Google live grounding requires an existing eligible Gemini project/key and verified billing/display policy. No Google binding on active staging. Egress reader requires the existing isolated VPC service and matching secret; do not weaken SSRF controls or remove Tavily Extract until the replacement is demonstrated.
- Reconcile provider usage and pricing, test strict city job details manually when safe, verify current model access, quality, timeout and actual app integration; test release/rollback plan and D1 migration against an isolated candidate. Owner approval is required before production or Tavily cutover.

References: https://developers.openai.com/api/docs/models/gpt-6-luna ; https://developers.openai.com/api/docs/pricing ; https://developers.openai.com/api/docs/guides/tools-web-search ; https://developers.openai.com/api/reference/overview .
