# BOR AI — Production Billing Prelaunch Audit (19 Nov 2026)

**Decision: NO-GO for real payments.** This is a code-review and scenario stress-test,
not a penetration test, not an accountant's opinion, not a merchant approval,
and not a real payment integration. Never enable production checkout based
solely on this report. The user's requirement is to keep BOR AI 100% owned
and protect the Basic $1.99 / Pro $6.99 hybrid subscription + top-up model.

## What was inspected

- `src/billing-staging-worker.js`, `src/billing-synthetic-gateway-bridge.js`,
  `src/duitku-v2-sandbox-contract.js`, `src/billing-ledger-foundation.js`,
  `src/billing-quote-core.js`, `src/credit-metering.js`
- Isolated staging billing D1 migrations 0001..0006, including immutable quotes,
  event idempotency, atomic ledger projection, rate limits, and callback aggregates
- Existing billing unit tests and the operator's **actual Sandbox proof**:
  one Basic IDR 35,821 order already `paid`, one 3,000-test-credit grant,
  wallet reconciled, `realCreditsGranted=false`; resend accepted as
  `paid_duplicate`. This is proof of a **paid-order replay**, not initial
  `pending -> paid` delivery and not live merchant approval.

## Security findings and explicit launch blockers

| Priority | Finding | Evidence | Required live gate |
|---|---|---|---|
| P0 | Live Duitku merchant/account and each chosen channel still unapproved or not independently documented | Sandbox merchant `DS...` only | Obtain merchant approval + written channel activation and separate scoped live credentials |
| P0 | Real customer checkout/entitlement is **not implemented/activated** | Current billing foundation is synthetic, staging D1 is isolated | Reviewed, separately tested implementation with a production feature flag initially off and safe rollback |
| P0 | Monthly subscription lifecycle is missing | Current Basic/Pro sandbox checkout creates a one-time invoice, not verified recurring renewal/cancellation/dunning/proration. Duitku subscription is a distinct API and supports certain channels, not generic VA monthly auto-debit | Define monthly entitlement periods, consent, manual vs recurring renewal, failed-payment grace, cancellation, credit expiry and refund policy; if recurring, verify merchant/channel eligibility and implement subscription webhooks separately |
| P0 | First `pending -> paid` provider callback has not been demonstrated end-to-end against a real live merchant | Only a paid-order replay was observed and independently audited | Create a controlled approved canary only AFTER merchant authorization; independently check provider status and verify exactly one grant |
| P0 | Actual money refund/chargeback automation **is not proven** | `checkReversal` exists only on synthetic/mock provider; Duitku V2 Sandbox adapter has NO `checkReversal` or refund/disbursement operation | Merchant-managed refund SOP with evidence and dual control; verified chargeback evidence, debt recovery, manual reconciliation; no fake reversal events |
| P0 | Model/tool consumption is not connected to a hard customer credit budget in production billing | `credit-metering.js` is opt-in and billing budget is a synthetic policy assumption | Reserve cost before API call, settle measured cost exactly once, cap maximum tokens/tool usage and account liability, refund on failed calls |
| P1 | Public merchant payment fees may differ; tax must not be charged twice | Duitku public tariff page says displayed fees **include VAT**; old staging fixture includes a separate illustrative `gatewayFeeTaxIdr=480` | Verify *merchant-specific* rates/fee bearer, channel settlement, and actual tax; replace the synthetic fixture in any approved future live pricing |
| P1 | FX is illustrative, not a live checkout lock | Existing staging `18000.25 IDR/USD` is an operator input | Versioned server-side FX source, validity window, customer-facing locked rate and immutable USD/IDR quote; no client repricing |
| P1 | Top-up and subscription liabilities/rollover are not finalized | `topup` only has offline quote core; no production liability policy | Enforce smallest viable top-up, credit expiration/rollover policy, refunds/dispute rules and revenue recognition review |
| P1 | Provider cost coverage incomplete | Proposed provider budgets Basic $0.30, Pro $1.50 do not automatically bound expensive models, image, research, tool calls | Versioned rate cards per provider/model, rate-change alarms, measured token and tool budgets; unknown rate => block |
| P1 | Operational controls missing production proof | Staging auth, cap and reporting tested only on isolated environment | Set abuse/fraud caps, secret rotation, alerts, dashboard, recovery/backup and rollback rehearsal |
| P2 | Privacy, invoices, receipts, tax filings, cancellation UX and customer dispute handling require release review | This audit is technical only | Legal/business review, record retention and data/identity policy, disclosures and customer support playbooks |

### Positive controls already present in staging

- Strictly separate Worker/D1 bindings from production, no real credit grants.
- Signed callback verification of merchant, HMAC, locked amount/order/reference.
- Authoritative provider `transactionStatus` check before a first settlement
  on pending orders (mock tests); paid replay is idempotent.
- Atomic append-only ledger and immutable quote/order checks, negative reversal
  debt projection for synthetic credits, HMAC + customer login + CSRF.
- Operator-only audit and reconciliation, limited staging test invoice
  creation, and separate read-only callback-report token.
- Verified historical Sandbox audit: `paid`, one credit grant of 3,000,
  wallet reconciled, no production entitlement.

**Important limitation**: a `paid_duplicate` reply checks a valid callback
HMAC against the existing settled order. It does **not** re-query the provider
when the order is already paid; this is expected for replay idempotency.
Never claim this proves a full initial payment lifecycle.

## Versioned unit economics — explicit modeled assumptions

All USD quoted to users are primary; IDR is a **locked checkout conversion
only after actual FX source approval**. These calculations never connect to
real payments. Reproduce using `node scripts/report-billing-prelaunch.mjs`.

- Monthly Basic **$1.99** and Pro **$6.99**, proposed **3,000/15,000 credits**
  respectively, not final. Budget **100 micro-USD provider cost per BOR credit**
  is *illustrative*; yields maximum provider allowances of **$0.30 / $1.50**.
  It is not a retail credit price or guaranteed consumption allowance until
  measured usage billing and reservation have been built.
- Illustrative FX **IDR 18,000.25/USD**, resulting in frozen gross **IDR
  35,821 Basic / IDR 125,822 Pro** for this mathematical example only.
- Duitku public method fees: **BCA VA IDR 5,000**, **Permata VA IDR 3,000**,
  **QRIS 0.7%**. The published Duitku price page says these **include VAT**,
  so no additional tax is charged in this scenario; the actual merchant fee
  schedule and channel availability remain unverified.
- Operating cash reserves per transaction: IDR 500 FX, IDR 700
  expected refund, IDR 1,000 other variable costs. These are **assumptions**,
  not audited expense data. Required contribution margin: **20% of gross**.
  Excludes corporate tax, accounting costs, discounts, withholding, fraud losses
  outside reserves, commissions, FX conversion at settlement and actual refunds.
- Example AI model GPT-5.4 mini (input **$0.75 / million tokens**, output
  **$4.50 / million tokens**, standard, no cache benefits) used solely as a
  transparent sample. Actual BOR AI may use different Terra/Sol/Luna/Workers AI
  models: they must be separately costed per rate version.
- Tavily PAYG API **$0.008 per Tavily credit**, basic search 1 credit,
  advanced search 2. No assumption of unlimited free Tavily access.
- *Nominal* Basic workload: 30 AI requests (2,000 input + 800 output each)
  plus 5 basic searches. Model $0.153 + Tavily $0.040 => **$0.193**
  modeled provider cost, or **1,930 BOR credits** using 100 micro-USD/credit.
- *Stress* Basic workload: 100 AI requests (4,000 input + 2,500 output
  each), plus 20 advanced searches. Model $1.425 + Tavily $0.320 =>
  **$1.745** cost, or **17,450 BOR credits**, more than Basic's 3,000.
  This scenario MUST be blocked rather than treated as profitable.
- *Nominal* Pro: 100 AI requests (2,000/800 tokens) + 20 basic searches
  => $0.670 provider cost, **6,700 of 15,000 BOR credits**.
  *Stress* Pro: 400 AI requests (4,000/2,500) + 20 advanced searches =>
  $6.020, **60,200 credits** — also MUST be blocked.

The model calculates conservative contribution using the greater of
**monthly package provider budget** and **scenario provider cost**,
then payment fee, FX reserve, refund reserve and other variable expenses,
all with exact integer arithmetic and round-up. A scenario is labelled safe
only if **both** credits needed fit its allowance **and** contribution clears
the minimum 20% screen. A passing scenario is never a green light for live
payments: rate snapshots, cap implementation, merchant fees, fraud, and tax
must be verified separately.

### Illustrative cash contribution and break-even

Under nominal usage, BCA VA fees and full provider budget reservation:
- Basic: IDR 35,821 gross - 5,000 fee - 2,200 reserves/variable
  - 5,401 provider budget = **IDR 23,220** contribution per paid user
  (before fixed operating costs and taxes).
- Pro: IDR 125,822 gross - 5,000 fee - 2,200 reserves/variable
  - 27,001 provider budget = **IDR 91,621** contribution per paid user.
- Hypothetical 70 Basic + 30 Pro paying users yields IDR **4,374,030**
  contribution before fixed costs. After **assumed** IDR 2,000,000 fixed
  monthly overhead, the illustrated result is **IDR 2,374,030** before
  tax, churn, real merchant terms and omitted costs. With only Basic,
  nominal break-even is 87 subscribers for that assumed overhead;
  with only Pro, 22 subscribers. These are not revenue forecasts.

## Remaining live readiness sequence (no approval implied)

1. Record Duitku merchant review outcome and channel contract; remain disabled
   until approved. Follow separate merchant-onboarding steps for QRIS/e-wallet.
2. Verify contract fee/settlement and clarify refund/dispute cash processes.
   Duitku currently says merchant handles actual refunds; do not synthesize
   money-movement evidence from a database reversal.
3. Obtain versioned OpenAI, Workers AI and Tavily invoices/rate cards and
   settle measured usage costs/credits. Design a credit reserve/finalize/undo
   state machine with per-call max output and tool caps. Determine whether
   Basic/Pro are manual monthly renewals or merchant-approved recurring debit:
   do NOT imply a one-off VA payment auto-renews.
4. Confirm server-owned FX rate, locked quote, USD accounting, IDR checkout
   and legal terms; test price rounding and cancellation.
5. Verify protected credentials/separate live adapter, multi-tenant auth,
   HMAC/replay, real provider status, pending reconciliation, refund/chargeback,
   per-account rate/amount limits, monitoring and safe rollback.
6. Run approved production canary with human sign-off **only after** all
   requirements above, and keep the initial activation disabled by default.

### Official references checked 19 November 2026

- OpenAI GPT-5.4 mini: https://developers.openai.com/api/docs/models/gpt-5.4-mini
- OpenAI API pricing/tools: https://developers.openai.com/api/docs/pricing
- Tavily pricing: https://www.tavily.com/pricing
- Tavily basic vs advanced: https://help.tavily.com/articles/6938147944-basic-vs-advanced-search-what-s-the-difference
- Duitku published rates, tax inclusion, and refund FAQ:
  https://www.duitku.com/harga/
- Duitku onboarding, channel activation and virtual account settlement:
  https://docs.duitku.com/en/account/
- Duitku distinct Subscription API (not implemented in BOR AI):
  https://docs.duitku.com/subscription/id/

**Audit type:** read-only GitHub code review + pure scenario simulation +
existing independent staging proof. No actual Duitku live API key, live
payment, merchant statement, settled payout, actual production token meter,
recorded monthly hosting expense, or real FX contract was audited.
