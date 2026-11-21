# BOR AI — Tavily safe mode without waiting for support (21 November 2026)

## Decision

**SEARCH/NEWS stays configured; user-triggered EXTRACT/URL Reader remains OFF by default.** This is a code-level safety proposal, not an assertion about currently deployed Cloudflare settings or provider billing. The repository's prior `URL_READER_ENABLED=true` and `TAVILY_EXTRACT_DAILY_URL_LIMIT=8` exposed a still-unverified path. This change sets both to `false` and `0` while retaining `SEARCH_PROVIDER=tavily`, `SEARCH_SHARED_BUDGET_ENABLED=true`, and the existing Search daily attempt ceiling of 12.

The Worker already tells its model and API clients that supplied URLs were **not read** when the reader flag is off. Tavily Search results may still provide citation-eligible **search snippets**, but they are not proof that BOR AI fetched the linked page. Do not describe Search-only snippets as full-page extraction.

## What can be independently established from public sources

- **Allowed integration:** a commercial, user-facing SaaS may invoke Tavily through the backend; protect API keys. https://help.tavily.com/articles/5880393096-permitted-use-customer-applications
- **Researcher billing:** Tavily states 1,000 monthly free credits, no card, and no charges unless pay-as-you-go is switched on. This is a provider statement, not independent verification of the live account. https://help.tavily.com/articles/8298987937-billing-credits-usage-limits
- **Usage controls:** per-request usage can be checked in Tavily's dashboard; the API-key limit must be checked in the account. Failed/errored/timeout charging is not conclusively specified by the FAQ; support is advised for disputed charges. https://help.tavily.com/articles/8298987937-billing-credits-usage-limits
- **Server-side SSRF:** Tavily's technical FAQ **does not confirm** all redirect, DNS rebinding or internal-IP safeguards; it refers customers to Trust Center/security support. https://help.tavily.com/articles/4262628172-data-sources-crawling-technical-behavior
- **Privacy:** customer-side right to store Extract output is not equivalent to Tavily's own input/response retention; sensitive data must not be submitted. https://help.tavily.com/articles/1612400809-storing-caching-retaining-output and https://help.tavily.com/articles/5154685404-restricted-uses-ai-functionality

BOR AI's support follow-up dated 18 November 2026 still requests Extract-specific DNS/redirect protections, URL/body/log retention and subprocessors, failed-request billing, and per-key credit enforcement. No individual technical answer was available at this review.

## Engineering safety improvement

The Extract adapter is maintained **for later reviewed activation**, not activated here. It now enforces one eight-second deadline across D1 quota admission, response headers and streamed response bytes, even when a mocked transport ignores AbortSignal. It enforces 1 MB of response bytes, strict UTF-8, URL response matching, query/credential rejection and bounded page text. It does not wait for potentially stalled stream cancellation and does not refund unknown provider attempts. New synthetic tests exercise stalls and malformed input; no Tavily provider call occurs in tests.

## Explicit remaining blockers and owner-controlled rollout

1. **Provider-side SSRF/redirects:** written vendor security evidence or a reviewed alternative pinned outbound fetch architecture, not just local URL syntax checks. No live SSRF probes against Tavily.
2. **Privacy:** provider terms for URL/page/log retention and improvement/training; user-facing notice, approved consent/legal basis, and safety review for paths containing potentially private identifiers.
3. **Budget:** current account settings confirming PAYG off and appropriate per-key limits, cross-feature usage reconciliation, D1 atomic cap validity, alerts and a maximum real invoice exposure.
4. **Verification:** complete CI on the exact patch, synthetic HTTP chat/search tests, then a separately approved bounded staging smoke and a reviewed production change with rollback.

**Deployment guard:** Do not silently merge, flip the extraction flag, rotate secrets or spend credits. Manual production promotion must verify the **active** Cloudflare Worker flags; changing GitHub config alone does not disable an already deployed Worker. Tavily Search may remain operational independently of Extract.

Related: issue #156 (egress/SSRF), PR #266 (earlier isolated timeout hardening), docs/TAVILY-PROVIDER-PRIVACY-BILLING-VERIFICATION.md.
