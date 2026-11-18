# BOR AI — offline margin stress scenarios (not commercial authorization)

This adds parameterized **contribution** checks for the proposed USD-based credit business, not net-profit claims or active billing. No API requests, production D1 changes, gateway calls, or customer transactions occur.

## Why these checks exist

A per-transaction bank VA fee can make small top-ups unprofitable even when the AI credits themselves cost little. Chargeback/refund reserves, FX conversion leakage, processing-fee tax, other variable expenses, and unexpected provider usage must not silently be interpreted as zero.

See `evaluation/bor-ai-margin-stress.js` and `tests/bor-ai-margin-stress.test.js`. Inputs are required integer IDR or basis points, and calculations round individual costs up.

The following assumptions are **made up for stress-testing**, NOT actual applicable merchant charges, government tax rates, observed refund rates, customer promises, approved minimum contribution margins, or a USD/IDR checkout quote:

- Reference USD/IDR = **18,260**, only to match the 17 November 2026 product page example.
- Basic **Rp36,338** and Pro **Rp127,638** are example gross prices (the approved price points are US$1.99/US$6.99). Actual checkout locks the authorized IDR quote.
- Draft credits 3,000 Basic and 15,000 Pro represent provider-cost allowances of **$0.30** and **$1.50**, using the **proposed**, nonlive credit mapping.
- For tests only: bank VA = Rp4,000, QRIS fee = Rp894 at Pro example, gateway-fee tax = **12%**, FX leakage = **2%**, refund/chargeback provision = **5%** of gross, other variable expense = **Rp2,000**, and an example minimum contribution hurdle = **40%**.

| Scenario | Gross IDR | Contributions after stipulated costs | Test verdict |
| --- | ---: | ---: | --- |
| Basic / bank VA (proposed allowance) | Rp36,338 | Rp21,836 | Passes **test-only** 40% threshold |
| Pro / QRIS (proposed allowance) | Rp127,638 | Rp88,311 | Passes **test-only** 40% threshold |
| Tiny Rp5,000 bank VA top-up (Rp2,000 provider allowance) | Rp5,000 | Negative | Fails |
| Basic with Rp20,000 nominal provider allowance and 2x overrun | Rp36,338 | Negative | Fails |

The fixed bank fee can make small purchases loss-making. **No minimum top-up is approved yet.** Merchant-specific costs and per-transaction fees are subject to Midtrans's agreement; its published price page warns that digital products may have different fees:
https://midtrans.com/id/biaya

Cloudflare per-token model prices are public reference rates, not evidence of a real invoice or reliable live per-request metering:
https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/

## Release boundary

Do not publish credit allowances or interpret these illustrative checks as verified profitability. Require actual usage and merchant-specific fees, a final exchange-rate/IDR checkout policy, refund/tax review, signed gateway reconciliation, a tested credit ledger, and explicit founder authorization before accepting payment.
