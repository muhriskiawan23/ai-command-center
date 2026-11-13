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

## Controlled merge/deploy procedure
1. Require all three CI workflows on the exact merge candidate commit to pass. Review the actual diff and verify no raw URL, page content, or API key is written to logs.
2. Merge with the repository default URL Reader flag **OFF**. A merge alone is not permission to turn on paid extraction.
3. Verify the deployed Worker environment independently: URL Reader disabled, no unexpected external extraction, chat and research still usable. Repository configuration is not evidence of live runtime variables.
4. Confirm provider contract, retention, processing location, DNS/redirect safeguards, pricing and billing cap. Configure the secret and daily budget through approved secret/config management without displaying secret values.
5. After explicit spending authorization and a successful controlled public-URL smoke test, enable only in the intended environment; observe quota and failure responses. Disable immediately on unexpected behavior.
6. Remove legacy VPC/proxy/Termux dependencies only after production replacement has been demonstrated and rollback tested.

Do not run paid Tavily requests or turn on production extraction solely because the user has authorized merge/deploy: those actions require verified provider billing and privacy gates.


## Provider policy and pricing desk review (2026-11-13; NOT activation approval)

Official Tavily sources reviewed:
- Extract API basics: https://help.tavily.com/articles/8721959612-what-is-the-tavily-extract-api — basic extraction is described as 1 API credit per 5 successful extractions, advanced as 2 credits per 5. This is a provider-credit unit, not a verified USD invoice rate; confirm billing/account plan and rounding for batches, failures and retries before making financial commitments.
- Customer applications: https://help.tavily.com/articles/5880393096-permitted-use-customer-applications — server-side integration into customer-facing commercial SaaS is allowed, but API-key resale/exposure is not; downstream users must comply with the AUP.
- AUP: https://www.tavily.com/acceptable-use-policy — prohibits submitting credentials and certain sensitive information without appropriate permission. URL path and arbitrary query values may contain secrets even if query-key filtering passes.
- Privacy policy: https://www.tavily.com/privacy — query data may be shared with third-party index providers; retention depends on purpose and other factors. Do not assume zero retention or single-region processing.
- EU endpoint: https://www.tavily.com/eu — EU query residency and optional zero-query-retention are described for enabled customers, not the default api.tavily.com endpoint.
- Provider output storage terms: https://help.tavily.com/articles/1612400809-storing-caching-retaining-output — permission for BOR AI to retain outputs is **not** evidence of Tavily's own input/query deletion schedule.

**Current decision:** KEEP URL_READER_ENABLED=false. The deployed secret presence and CI do not verify provider-side SSRF protections, DNS/redirect behavior, Tavily account billing hard stops, default-region retention, or successful live Extract calls. Existing atomic D1 quota limits attempts, not invoice dollars. No paid/live provider smoke has been authorized or run in this review.

Before opt-in: obtain provider confirmation of redirect/DNS safety, processing/retention and subprocessor handling; inspect Tavily dashboard plan, USD credit cost, usage caps and alerts; add end-user notice that submitted public URLs are sent to Tavily; obtain founder approval for a bounded real-provider smoke and budget. Do not activate based on documentation alone.


## Verified follow-up evidence (2026-11-13; URL Reader remains OFF)

- One authorized real Tavily Extract request succeeded: GitHub Actions run [43381839005](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43381839005). The returned URL exactly matched the requested public URL and extracted 156 text characters. This is a provider connectivity smoke test, **not** end-to-end application verification.
- Privacy hardening merged in [PR #229](https://github.com/muhriskiawan23/ai-command-center/pull/229), merge SHA `ca29b2c8883826bc03b2802b7eb2b6f8ef1808a5`. The Tavily adapter now rejects **all URL query strings**, including innocuous parameter names whose values could contain secrets. URL fragments are stripped. URL paths can still embed sensitive data, so this is not a complete privacy solution.
- CI on the fix SHA `d3cf57c9`: tests [43382466109](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43382466109), browser E2E [43382466118](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43382466118), preview build [43382466365](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43382466365), all SUCCESS.
- Production deploy [43383882696](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43383882696) succeeded on `ca29b2c`, Worker Version `4e507f46-f43f-4c50-919d-3e5f0a62767b`. Deep health and endpoints passed; `TAVILY_API_KEY` Worker secret presence was verified without exposing its value. Production traffic audit [43383992602](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43383992602) and Cloudflare VPC audit [43383992809](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43383992809) passed. Optional live Tavily smoke was skipped.
- `wrangler.jsonc` still sets `URL_READER_ENABLED=false`. This is repository configuration; verify live runtime flags independently before activation.
- Source review: `src/index.js` routes both user-provided links and **research-result URLs** through Tavily when enabled. A single global D1 URL-attempt quota is shared across both paths. Enabling URL Reader can therefore transmit URLs discovered through third-party search to Tavily, not only URLs typed directly by users.
- `src/links.js` wraps extracted text as untrusted page context, neutralizes angle brackets and instructs the model not to obey web-page instructions. This is defense in depth, not proof against prompt injection.

### Remaining release blockers (explicitly NOT cleared)
1. Obtain and record provider-side DNS/redirect/private-network protection evidence, retention and regional/subprocessor terms, and a user-facing disclosure/consent policy. Public-looking URL **paths** can contain private tokens; query rejection alone is insufficient.
2. Verify actual Tavily account plan, credits, billing limits, alerting and failure/retry charging. The D1 daily quota is a **request-attempt ceiling, not a guaranteed USD hard stop**.
3. Run end-to-end tests of chat and research URL handling with **mocked Tavily responses** and confirm feature-off paths; test prompt injection, failures, 429, oversized bodies, timeouts, and D1 quota exhaustion. No further paid calls without renewed authorization.
4. Verify live Cloudflare environment variables and a safe, documented rollback. Obtain explicit owner approval before any production activation.

**Decision: NO-GO for URL Reader activation.** The successful provider smoke and production deployment do not clear these blockers.
