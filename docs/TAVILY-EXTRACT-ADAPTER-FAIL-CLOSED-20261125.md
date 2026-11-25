# BOR AI — Fail-closed Tavily Extract adapter feature gate

**Status:** source-only hardening, not a production rollout or provider audit.

## Why
BOR AI calls Tavily Extract via an authenticated server-side adapter. Its HTTP chat and research handlers already inspect `URL_READER_ENABLED`; however, a future internal call site could call `extractWithTavily` or reserve quota without those handler checks. Possession of a Tavily API key plus a nonzero D1 budget must not by itself authorize a third-party URL request.

## Change
- `extractWithTavily` now independently requires both `URL_READER_ENABLED === "true"` and `URL_READER_PROVIDER === "tavily"` before any quota reservation or outbound request.
- `reserveTavilyExtractBudget` enforces the same feature gate, including for direct library callers.
- Invalid/disabled state refuses the request and preserves a blocked URL's existing validation explanation. It never silently switches to a generic Worker fetch or an alternative paid provider.
- Existing tests explicitly opt in on their **synthetic** Tavily fixture; new cases prove missing, mismatched or disabled flags yield no D1 or provider calls, and the opt-in fixture still works.

## Local isolated module smoke
On 25 Nov 2026, the exact changed module source was executed in an isolated JavaScript test harness with mocked URL parsing, D1 admission and HTTP response stream. Three disabled/invalid flag cases yielded **zero** reservations/provider calls; the explicit active Tavily case returned bounded synthetic page text after one mock reservation and one mock provider invocation. **This is not a substitute for full Node CI, live security review, or real-provider smoke tests.**

## Production release boundary
The **100%-active** Cloudflare Worker version at audit still had Tavily Reader ON with an 8-URLs-per-day Extract admission ceiling, while reviewed `main/wrangler.jsonc` defaults to Reader OFF with budget 0. Merging this code alone changes no live binding. The manual deployment pipeline must preserve that independently verified active configuration, or explicitly obtain separate approval before any shutdown; do not auto-enable paid extraction, expand its quota, or silently disable the user's existing Reader.

Provider-side DNS-rebinding/SSRF redirect defenses, URL/content retention, use for model training, exhausted-key billing behavior and real USD spend control remain unresolved. Keep security issue #156 open until verified, and do not infer that module-level gating solves those external issues.
