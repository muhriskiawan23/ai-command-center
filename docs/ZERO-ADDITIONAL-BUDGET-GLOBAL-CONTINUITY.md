# BOR AI — $0 additional-budget global continuity contract (offline only)

23 Nov 2026. Owner's **currently authorized additional monthly spend is $0**.

A global DNS/edge footprint is not the same as a globally funded, 24/7 inference
service. Free tiers and quotas can exhaust or throttle, and **no provider offers
a zero-downtime guarantee**. No new paid resources, backup model accounts or
subscriptions can be enabled without explicit owner authorization and a
recurring USD cost ceiling.

## Offline contract covered by the new CI test

- A synthetic signed-in account has an existing two-message conversation.
- The primary AI throws a documented quota/capacity failure. Chat returns a
  non-success status, no saved acknowledgment, no additional database message
  rows, and the failed customer's daily-use reservation is refunded.
- Existing chat history, public health and agents remain readable while AI
  inference is unavailable. **This is tested with only the AI stub failing**;
  a real D1 or Worker outage is not covered.
- When the fake AI recovers, repeating the same request ID saves exactly one
  user+assistant pair and a further replay leaves the pair unchanged.
- Paid fallback remains disabled even when a synthetic old secret is present.

## Safe current operating policy

Keep production paid image generation, paid backup, browser execution, payment
subscriptions and fresh third-party API spending **OFF** unless separately
funded, security-reviewed and explicitly released. Rate-limit and return
truthful capacity errors; never return a fabricated AI answer or claim a
failed chat was saved. The existing domain/static app can be internationally
accessible, but a large public paying customer base must wait for proven
resource headroom, hosted recovery, provider/failover funding, fraud/billing
controls and observability.

### Outstanding blockers
- Production live URL Reader/Extract state does not match reviewed main; the
  read-only readiness audit is red (#156).
- Hosted D1 post-checkpoint recovery and complete writer coverage are not
  proved (#382).
- Paid second AI provider and failover are **not funded** and API compatibility
  is not independently confirmed (#385).
- Live traffic measurements, inference success SLO and multi-region synthetic
  canaries do not exist as verified production evidence.

This PR changes only tests and documentation. Its passing result is not a
live Cloudflare or provider availability, price or capacity certificate.
