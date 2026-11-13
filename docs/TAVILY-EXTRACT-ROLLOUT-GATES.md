# Tavily Extract rollout gates (BOR AI)

Status: **NOT APPROVED FOR PRODUCTION ACTIVATION**. This checklist records controls visible in the PR, not a completed independent security or privacy assessment.

## Architecture
- URL extraction is sent server-side to `https://api.tavily.com/extract` using the `TAVILY_API_KEY` secret. The user-supplied URL and resulting page content are processed by Tavily, a third party.
- Tavily extraction is selected only when both `URL_READER_ENABLED === "true"` and `URL_READER_PROVIDER === "tavily"`. Existing legacy reader remains the fallback; its proxy is not removed in this PR.
- Worker never directly fetches the user-supplied URL through the Tavily adapter; the Tavily service retrieves the page. Local URL validation is a defense-in-depth filter, **not proof of Tavily's own DNS/redirect protections**.

## Verified in code/tests (not a production penetration test)
- Public URL validation, at most three URLs per extraction batch, URL deduplication, an eight-second provider timeout, one-megabyte response limit, and 16,000-character page text limit.
- Provider redirect response is not followed automatically by the Worker; response errors fail closed without returning provider error bodies or API secrets.
- Returned URLs are accepted only when they exactly match an eligible requested URL.
- Existing chat rate/daily limits are enforced before external work; **these do not establish a hard per-account Tavily credit budget**, especially for research plus user URLs.

## Open gates (must resolve before enabling)
1. **Security:** independently verify Tavily's handling of DNS rebinding, provider-side redirects to private networks, public domains resolving to private IPs, nonstandard encodings, and prompt injection in extracted content.
2. **Privacy:** document that submitted URLs go to Tavily; confirm Tavily retention, regional processing, subprocessor terms, and whether URLs can contain private query tokens. Decide whether to strip fragments and reject URLs containing credentials/tokens in query parameters; avoid sending sensitive URLs without explicit policy.
3. **Cost:** confirm current Tavily Extract pricing and billing quotas; add enforceable server-side daily extraction credits/request caps, including combined chat and research paths, and alerts before turning on the feature.
4. **Stability:** run integration tests against a controlled public test site and real provider, including timeouts, malformed responses, empty pages, 429s, 5xx, and rollback.
5. **Deployment:** confirm `TAVILY_API_KEY` is configured as a secret in the target environment; verify preview/production configs separately and keep feature off until explicit approval.
6. **Legacy cleanup:** remove `EGRESS_PROXY` binding and Termux/tunnel workflows only after replacement is verified and deployment can proceed without VPC binding dependencies.

## Safe rollback
- First disable `URL_READER_ENABLED` in the active Cloudflare environment (not just the repository) and deploy/verify; if the legacy reader is still present, confirm it fails closed or is separately disabled.
- If Tavily itself must be disabled immediately, revoke/rotate `TAVILY_API_KEY` in the provider and Cloudflare secrets as appropriate.
- Verify the live chat URL path and research path return a clear unavailable result and do not make Tavily extraction requests.
- Preserve incident logs without raw URL tokens, secrets, or full extracted page text.

## Sign-off evidence required
Record CI run IDs, independent review findings, real-provider smoke test timestamps, budget/alert configuration, privacy disclosure, deployment version, rollback test, and explicit owner approval. **Do not merge or activate solely because CI is green.**

## Implemented global budget (pending CI and live verification)
The Tavily adapter now reserves an atomic global D1 quota before each provider call: default 30 unique extracted URLs per UTC day, configurable via `TAVILY_EXTRACT_DAILY_URL_LIMIT`. Both chat and research extraction share this counter. Missing D1 fails closed; failed provider calls keep their reserved quota. This is not a per-user quota, does not prove provider credit prices, and requires live validation and billing alerts before enabling.

## Additional hardening (pending latest CI)
- `TAVILY_EXTRACT_DAILY_URL_LIMIT=0` disables provider extraction; negative, empty, noninteger, or over-10,000 values fail closed rather than silently reverting to the default.
- Reject URLs with embedded username/password before third-party submission. Sensitive query-key filtering and fragment removal are also in place, but URL paths and unknown query names may still contain private data.
- The feature flag now guards both Tavily and legacy URL reads. Existing test fixtures explicitly enable the reader where needed.
- These protections are code-level controls; independent privacy/security review, provider billing verification, and real-provider smoke testing remain open.

## CI and review snapshot (2026-11-13)
- Commit `e2227a183e3dece08212695acd2baa90ddd805fc`: tests `43361170192` SUCCESS, preview `43361170467` SUCCESS, browser e2e `43361170240` SUCCESS.
- GitHub PR #224 has no submitted reviews at this snapshot. Passing CI is not independent approval.
- Repository `wrangler.jsonc` keeps `URL_READER_ENABLED` set to `false` and retains the `EGRESS_PROXY` VPC binding. The live Cloudflare environment has not been verified from this repository inspection.
- `TAVILY_API_KEY` presence, provider billing caps, real Tavily extraction response, and privacy terms have **not** been verified. Do not activate or remove legacy connectivity until these gates are closed.
