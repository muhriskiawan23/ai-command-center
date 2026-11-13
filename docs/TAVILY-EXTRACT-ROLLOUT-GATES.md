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
