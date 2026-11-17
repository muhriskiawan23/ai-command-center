# BOR AI Stage 3 — published-cost evidence (17 November 2026)

Status: **RESEARCH / NOT AN APPROVED CUSTOMER TARIFF, MARGIN OR BILL**.
No real provider calls, payment orders, production D1 writes, or price changes.
The figures below are publicly displayed **reference rates**, not account-specific
billing statements. Reviewer must recheck the vendor source and invoices.

## Actual model being routed

`src/model-gateway.js` currently defines default Workers AI model
`@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Its baseline fields still
correctly show null cost/context metadata in production until approved.

Cloudflare's official model page on 17 November 2026:
https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/

- Model ID: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Listed context window: **24,000 tokens**.
- Published unit pricing: **$0.293 / million input tokens**, and
  **$2.253 / million output tokens**.
- Cloudflare's official pricing table also lists 26,668 neurons per million
  input tokens, 204,805 neurons per million output tokens.
  See https://developers.cloudflare.com/workers-ai/platform/pricing/
- Published token-equivalent pricing is **not evidence that an individual
  account's full invoice has been reconciled**. Free-tier allowance, overage
  eligibility, time window and Workers-specific usage must be verified.

### Exact integer comparison to synthetic fixture

The existing test-only fixture for the same rates is 293000 and 2253000
**micro-USD per million tokens**. On a purely hypothetical call with
1,000 input tokens and 100 output tokens:

- Input = 1000 * 293000 / 1000000 = **293 micro-USD**.
- Output = 100 * 2253000 / 1000000 = **225.3 micro-USD**.
- With the project's upward micro-USD rounding rule, total =
  **519 micro-USD** ($0.000519).
- This reproduces a **test fixture**, not an authoritative real usage record.

For an illustrative bound of 12,000 input and 700 output tokens,
provider maximum before retry/multi-agent multiplication =
**5,094 micro-USD ($0.005094)** after ceiling.
This is **not** an approved output cap. Confirm the true input
context (system prompts + conversation) and enforce `max_tokens` at every
actual model call, including agents and retries, before tariff activation.

## Payment gateway publicly listed reference fees

Midtrans official published pricing on 17 November 2026:
https://midtrans.com/id/biaya

- Virtual account / bank transfer (listed common category): **Rp4.000
  per transaction**.
- QRIS: **0.7%** per successful transaction in standard listed category.
- GoPay and ShopeePay: **2%** per transaction in the standard listing.
- **Important exception:** Midtrans expressly states that *gaming and
  digital product* merchants can have **different QRIS and wallet pricing**.
  BOR AI is a digital service. Do **not** assume these standard published
  fees apply to the specific merchant agreement.
- Activation review, supported channels, negotiated fees, settlements,
  applicable tax, rounding, chargeback/refund fees, and local currency
  conversion **must be confirmed in actual merchant account and contract**.

Midtrans QRIS guidance: https://docs.midtrans.com/docs/what-is-the-applicable-transaction-fee-for-qris
(The generic 0.7% MDR is not a substitute for BOR AI merchant classification.)

## Unit-economics hold and required source of truth

Candidate Basic $1.99/month and Pro $6.99/month are not approved or live.
Before selecting included credits, rollover or top-up price, obtain:

1. Historical per-model token distribution, actual measured output counts,
   retry rate and agent-call multiplier; record sample size and confidence
   bounds. Do not multiply just by message count.
2. Cloudflare billable usage and actual invoice/dashboard neuron amounts,
   matched for a bounded, separately authorized staging period.
3. Tavily contract and per-operation charges, URL Reader SSRF/privacy
   review and confirmed policy. URL Reader remains OFF.
4. Midtrans merchant-specific rates, FX snapshot, fee and tax handling,
   refund/chargeback exposure and payment confirmation policy.
5. Margin stress testing at near-full allowed usage, plan mix, high
   response sizes, repeated agent calls, failed payments, one-time and
   renewal grants, and any Pro-only rollover obligations.
6. Signed finance and security review plus founder approval of a
   versioned pricing snapshot. No testing-only `approved:true` fixture
   is a valid commercial approval.

Result today: **published rate comparison available; authentic invoice
reconciliation, merchant-specific fee verification, and commercial margin
approval NOT completed**.

Source references captured above are informational URLs, not automatically
accepted or versioned tariff inputs. Never modify live prices from this file.
