# BOR AI — Free access and proposed paid-credit policy
_Date: 17 November 2026 • Status: design proposal, no paid activation_

## What is actually live

- **Free:** US$0 / Rp0. Clicking `/?plan=free#/` opts into the already implemented Guest chat. It does not request card, payment form or subscription; authenticated visitors stay authenticated. The server retains all its existing rate/usage guardrails.
- Existing code `src/daily-limits.js`: Guest **15 units per day** and signed-in account **150 units per day** by default; application-wide default 1,500/day. A normal chat consumes **1 daily unit**; a multi-agent chat consumes **3 daily units**. Environment overrides may alter quotas. Usage reset is at **07:00 WIB** (UTC midnight). These units **are not model tokens, money or paid credits**.
- Guest chat content lives only in the active page memory and disappears on refresh/leave. Signed-in conversation history is saved per-account, with available delete/export features.
- The chat and specialist/multi-agent modes exist in the code. External live web search depends on separately configured provider, status and security approval. Do not advertise search, premium-model access, guaranteed priority, unlimited use or paid entitlements as live without proof.

## Founder decisions

- Basic is **US$1.99/month** and Pro is **US$6.99/month** as approved USD list prices.
- Customers in Indonesia must see an authoritative **IDR total locked at checkout** before choosing a Midtrans payment method. Free is always Rp0 and skips checkout.
- Paid subscriptions, paid-credit wallet and top-ups remain **unavailable** until metering, billing, gateway reconciliation and margin gates pass.

## Verified upstream rate snapshots (not BOR AI customer price)

The running default model ID in `src/model-gateway.js` is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. Cloudflare's official pricing lists **US$0.293 / million input tokens** and **US$2.253 / million output tokens** for this model:
https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/

Tavily's official pay-as-you-go list is **US$0.008 per API credit**; basic Search consumes 1 API credit and advanced Search 2:
https://www.tavily.com/pricing
https://help.tavily.com/articles/6938147944-basic-vs-advanced-search-what-s-the-difference

Both are provider rates; fees, FX, other provider models, retries, multiple agent calls, taxes, storage and any third-party API expenses require separate measurement. Do not assume the Cloudflare free daily neurons allocation is a guaranteed free subsidy.

## Concrete proposal to validate before selling

**Accounting definition (proposal): 1 BOR customer credit = US$0.0001 of metered, provider-variable AI/search cost.** Thus 10,000 BOR credits = US$1.00 provider-cost allowance. This is **not 1 token = 1 credit**; actual token input/output counts and model-specific prices determine the debit. Internal balances should be stored in precise integer microcredits, with conservative per-request rounding.

| Tier | USD list price | Proposed included BOR credits / billing month | Maximum metered provider-cost allowance | Share of list price |
|---|---:|---:|---:|---:|
| Free Guest | $0 | No paid credits; daily units instead | Not applicable; existing daily safety caps | n/a |
| Basic | $1.99 | **3,000 credits (proposed only)** | **$0.30** | 15.1% |
| Pro | $6.99 | **15,000 credits (proposed only)** | **$1.50** | 21.5% |

Price points are approved; **credit grants and paid benefits are not approved/final or active**. Rollover: none in the first release unless future actual-cost evidence supports it. Top-up amounts/prices: not decided, no live purchase.

Example with one model call of 2,000 input + 500 output tokens using the Cloudflare 70B model:
`(2,000 × 0.293 + 500 × 2.253) / 1,000,000 = $0.0017125`, which rounds **up to 18 BOR credits** for that provider spend. A Tavily basic search, if configured and allowed, adds `$0.008 = 80 BOR credits`. A multi-agent chain must sum **all** its actual model calls, not pretend that its 3 daily units equal 3 paid credits. These are worked examples, not typical usage promises.

Estimated **remaining revenue before other expenses** if credits are completely consumed: Basic $1.69, Pro $5.49. These are **not margins or profit** and must not be promoted as such; subtract payment processing, FX, taxes, refunds, Workers/DB/other infrastructure, fraud and support costs as applicable.

## Mandatory before finalizing credit allocations

1. Confirm provider-account plan/rates and capture trustworthy input and output token usage for every real model call, including multi-agent, failed calls and retry attempts. Validate against Cloudflare's invoice/usage reporting.
2. Verify Tavily availability and real request charges; account for Basic/Advanced search and Extract. Disable any unverified cost-bearing features rather than billing as if free.
3. Use deterministic versioned customer-debit tariffs and reserve the maximum allowable spend *before* any external call; reconcile actual cost and release unused reservation. Fail closed on unknown cost, missing budget or inconsistent ledger.
4. Enforce per-user balance, per-request spend ceiling and global/provider daily budgets; verify retries, concurrent requests, refunds and Midtrans webhook idempotency in sandbox/isolated D1.
5. Simulate worst-case full credit consumption plus gateway, FX, fee, refund, chargeback and taxes. Revisit the unusually generous default signed-in Free allowance (150/day) before paid launch, because Free should not silently undercut or bankrupt the paid products.
6. Only after the above and explicit founder approval, publish numeric credit allocations as contractual customer benefits, enable checkout and activate paid billing. Midtrans merchant-review form submission is **not** production billing approval.

**Decision distinction:** This document locks a useful *draft conversion mechanism and candidate allowances*, not live grants, provider costs, package entitlements, profitability, or production activation.
