# BOR AI Pro-only controlled rollover — proposed policy and financial launch gates

Status: DRAFT, NOT LIVE. This policy is a candidate, not a guarantee of profitability. No production payments, credit issuance or URL Reader activation is authorized.

## Package eligibility

| Package | Candidate monthly price | Subscription credit rollover |
| --- | --- | --- |
| Basic | USD 1.99 | None |
| Pro | USD 6.99 | Eligible only after cost-model approval |

Prices are provisional. Included credit amounts, conversion rates, payment fees, taxes, and provider costs are not yet verified.

## Pro rollover proposal

- Carry at most **25% of the Pro monthly included grant** from unused current-period **subscription** credits. Do not calculate the cap as 25% of an accumulated balance.
- Eligibility requires successful renewal into another Pro billing period. Failed renewal, downgrade and cancellation do not create a new rollover grant. Treatment of already-carried credits during payment grace periods requires a published policy.
- Carried credits expire at the end of the immediately following paid billing period. **No rollover of rollover**; never create multi-month accumulation.
- Rollover credits are spent first, then current-period subscription credits, then separately purchased top-up credits (subject to transparent user-visible spending rules).
- Track credit origin, grant period, expiration, reserved/spent balance, and parent grant. Do not collapse all credit types into a single undifferentiated balance.
- Top-up credit expiry, refunds, cancellation rights and consumer-law requirements are a separate policy decision; do not silently expire purchased credits using subscription rules.
- Show eligibility, expiry, maximum carried amount and credit consumption order clearly before purchase and in the user's balance.
- At billing-period close, settle or safely cancel outstanding reservations before calculating carry-forward; idempotent renewal must not grant rollover twice.
- If the same user has several plans/orders, enforce one active subscription grant per paid period and deterministic plan transitions.

## Provider cost exposure

- Cloudflare Workers AI performs core inference; Tavily Extract is an optional URL extraction provider and **not a mandatory per-message monthly subscription**. The user's Tavily Researcher Free account previously showed 1,000 monthly API credits and PAYG OFF, but provider billing, safety and privacy details are still awaiting verification.
- Production URL Reader remains OFF and Tavily Extract daily quota defaults to zero. Never use an assumed free Tavily allocation to guarantee future profit.
- Existing BOR AI daily request quotas are not token-based billing. Current Workers AI model rate fields are unknown; actual token counts and billing need measurement.
- Paid plan margin must account for **worst-case** combined current-period + carried credits used in one period, model output variability, multi-agent amplification, search/extract charges, gateway fees, FX, tax and refund/chargeback exposure.
- Reserve enough funds for outstanding customer service obligations. A 25% rollover cap limits exposure but **does not prove profitability**.

## Required financial calculations

Let G = Pro included monthly credits; R = min(unused eligible current-period credits, floor(0.25 * G)); N = new-period credits; P = net recognized subscription revenue in USD after transaction costs and relevant taxes; C = verified conservative maximum variable cost USD per customer credit.

A necessary (not sufficient) safety gate for a renewal period is:
`(N + R) * C + other variable costs + refund/chargeback reserve <= P`.

For conservative capacity planning use `R = floor(0.25 * G)` and account for any separately purchased top-up obligations with their own prepaid funding and margins. This inequality does not replace cash-flow, lifetime-value, accounting liability or abuse analysis.

Example **hypothetical** only: If G = 1,000 and rollover cap = 250, a renewed Pro customer may use 1,250 subscription credits during the next period. At $6.99 gross price, the **absolute gross revenue ceiling before fees/other costs** is $6.99 / 1,250 = $0.005592 per credit. The true permissible provider cost is lower. Do not treat that figure as an actual credit price or approved tariff.

## Ledger and rollout gates

1. Implement credit lots/grants and expiry with immutable journal entries, distinct from a balance projection.
2. Prove atomic reserve, settlement, refund/release, double-spend prevention, concurrent requests, idempotent renewals and period transitions using realistic D1 integration tests.
3. Verify D1 transaction semantics: a successful SQL batch with zero affected rows must not be treated as a successful debit; an application-side post-batch check alone cannot roll back a committed batch. **Current PR #245 reservation prototype must not be integrated into paid traffic until this is fixed and tested.**
4. Keep daily hard provider spend ceilings, per-request limits, and kill switches; refuse paid work when cost or credit authorization is unknown.
5. Obtain actual Workers AI token pricing and metering, Tavily provider billing answers, gateway fee schedules, FX and settlement terms.
6. Run stress scenarios for full rollover redemption, heavy multi-agent usage, payment failures, chargebacks and provider price increases.
7. Explicit owner approval before implementing or advertising rollover as a live benefit.

Decision pending: Pro-only eligibility and 25% one-period carry are proposed for product planning; included credits and activation remain blocked on verified economics.
