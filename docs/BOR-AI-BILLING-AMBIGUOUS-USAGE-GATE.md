# BOR AI — Ambiguous provider usage must not release synthetic credit reservations

This offline-only hardening applies to `src/billing-provider-metering-offline.js`; the live Worker does not import or expose it. It does not call OpenAI, Cloudflare AI, Tavily, Duitku or any provider.

## Change

- A provider response that reports `prompt_tokens=0`, `completion_tokens=0`, and `total_tokens=0` is **not** proof of zero financial charge. The synthetic reservation remains in the `held` state with `reconciliation_required`; a second customer request ID replay does not invoke the provider again.
- Provider receipts with positive audio, image, video or speech usage markers at the top level or within prompt/completion token-detail objects fail closed under **text-only** tariffs, including when a total token count is present. Cached text tokens remain conservatively billed at the full input rate until verified cache-specific pricing exists.
- No automatic reservation release on ambiguous network/receipt responses. Only the existing separately verified no-provider-charge path may release holds.
- These checks do not solve approval of rates, billing invoices, or real provider evidence. Unpriced modalities must have separate audited cost models before enabling customer entitlements.

## Reproduce

`node --test tests/billing-synthetic-usage-reservations.test.js`

## Release boundary

No commercial billing, production credit debits, billable provider integration, live gateway or customer action is activated. This is an **offline precaution** supporting P0 issue #318, not a closure of that issue.
