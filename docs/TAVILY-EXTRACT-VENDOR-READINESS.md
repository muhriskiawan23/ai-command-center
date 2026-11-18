# BOR AI — Tavily Extract vendor review and launch gates

**Reviewed 18 November 2026; draft, not permission to activate production.**
The user's requested Tavily policy collection and Tavily's other official FAQs
were checked against the actual 13 and 15 November BOR AI support questions.
These documents must not be confused with independent network security proof.

## What the public docs do and do not answer

| Question | Status | Source / limitation |
| --- | --- | --- |
| Commercial end-user app via BOR AI backend | Documented permitted | https://help.tavily.com/articles/5880393096-permitted-use-customer-applications — keep key server-side; no direct API resale |
| Free Researcher plan without pay-as-you-go | Documented hard stop | https://help.tavily.com/articles/8298987937-billing-credits-usage-limits — 1,000 credits/month; no charges unless PAYG enabled |
| Allow Use of Query Data OFF | Documented for query data | https://help.tavily.com/articles/4205958832-understanding-the-allow-use-of-query-data-setting — disabled query-data improvement/storage; does **not** enumerate Extract body, request logs and subprocessors |
| API-key monthly usage controls | Documented as configurable | https://help.tavily.com/articles/9170796666-how-can-i-create-an-api-key — monthly limits; requires account-level verification whether limit covers *both* Search and Extract and is pre-charge hard enforcement |
| DPA, sub-processors and jurisdiction | Partly documented | https://help.tavily.com/articles/8202749643-gdpr-dpa-security-documentation — DPA can be requested under stated terms; trust center lists vendors; not proof of retention periods for every API payload |
| Retaining Extract output in our own database | Documented as generally allowed subject to source rights | https://help.tavily.com/articles/1612400809-storing-caching-retaining-output — customer output retention **is not** Tavily server-side request-log retention |
| Failed Extract / timeout / HTTP 5xx / retry charges | **Unresolved** | https://help.tavily.com/articles/8298987937-billing-credits-usage-limits points to credits docs or support; cannot assume zero billable credit |
| Per-request ledger reconciliation | **Unresolved** | usage dashboard documents per-request logs but not a contractual cost identifier/atomic reconciliation guarantee: https://help.tavily.com/articles/7015474742-tavily-usage-dashboard |
| Private IP, metadata IP, redirect-to-private and DNS rebinding | **Unverified / NO-GO** | the linked privacy collection contains no tested guarantee of outbound destination validation and pinned-peer checks |
| Retention/deletion of full Extract inputs and outputs, AI training/subprocessor data processing with query-data OFF | **Unresolved** | generic privacy FAQ does not specify all of these categories |

## Controls already present (main branch)

- Production `URL_READER_ENABLED=false`; this document does not change it.
- `TAVILY_EXTRACT_DAILY_URL_LIMIT` defaults to zero, and extraction refuses calls
  if global D1 quota state cannot be reserved.
- `src/tavily-extract.js` validates public URL literals, disallows credentials,
  query parameters and URL fragments, deduplicates requests, and uses manual
  redirects for the **Tavily API endpoint**. This does **not** prove the
  *provider's* internal crawler pins safe network destinations or rejects
  redirects inside a page-extraction session.
- Quota is a conservative bound on **attempted URLs**, not confirmation of
  actual vendor credit consumption. Unknown outcomes remain charged against
  local attempt quota and are not automatically refunded.

## Additional isolated hardening proposed in this PR

- A maximum 8-second deadline now controls both API response headers and
  streamed response body, even if a synthetic transport ignores abort.
- Advertised and streamed response bytes are bounded at 1 MB and malformed
  UTF-8 fails closed.
- Stream cancellation is never awaited, so an unresponsive `cancel()`
  cannot delay the request. Failures return generic user-safe errors.
- No key, query, user content, or live provider request is used in the tests.

## Remaining prerequisites before enabling user URL reading

1. Written provider answers about SSRF/DNS rebinding and internal redirect
   protection; if absent, a controlled egress architecture with independent
   network proof. URL Reader must stay off under security issue #156.
2. Written provider policy on data handling with query-data OFF for full Extract
   payload, URL, diagnostics, usage logs, subprocessors, deletion and model use.
3. Verified credit rules for failure, retries, partial batches and the actual
   billing/dashboard reconciliation procedure.
4. Verify key-level monthly limits and PAYG OFF in owner-controlled account
   settings, then implement a versioned USD tariff and independent provider
   spend guard with staging-only tests and owner approval.
5. Independent privacy/finance/security review and explicit release GO from
   the founder. Do not change production flags, secrets, accounts, or plan
   settings as a consequence of this document.

**Vendor follow-up:** 18 November 2026, reply sent to
`support@tavily.com` in the original November 13 thread, requesting direct
documentation or written confirmation for the unresolved items. The Midtrans
merchant activation is a separate dependency and remains pending.
