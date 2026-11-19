# BOR AI — Safe synthetic AI/tool credit holds (STAGING ONLY)

**Status: NOT LIVE, not deployed, not integrated with the production Worker.**

This PR adds a proof-of-concept credit reservation, metering settlement and
competing-request safety net against P0 issue #318. It is **only for
isolated billing staging D1**, not real customers and not a production
subscription implementation.

## Safety model

- An offline trusted service (there is no public HTTP route) computes
  a **worst-case reservation** using explicit model ID, rate version,
  input/output max token counts, Tavily/tool maximum provider credits,
  and audited positive micro-USD provider rates.
- `estimateSyntheticCreditHold` computes
  `ceil((ceil((maxInputTokens * inputRate + maxOutputTokens * outputRate) / 1e6)
   + maxToolCredits * toolRate) / creditValueMicroUsd)`.
  Input/output rates are **micro-USD per million tokens**; tool rate is
  **micro-USD per tool provider credit**; credit value is micro-USD
  budget per BOR credit. Never represent unverified costs as zero.
- `reserveSyntheticCredits` creates an immutable per-user, per-request
  hold. SQLite `BEFORE INSERT` trigger enforces that available synthetic
  wallet credits (minus other held credits) cover the worst case. All
  concurrent reservations compete on the same wallet; no credit is actually
  deducted until measured usage is finalized. The old direct debit route
  is now also protected against spending credits held by another request.
- `settleSyntheticCredits` requires **measured=true**, refuses values
  beyond the originally reserved max, uses persisted versioned rates,
  and finalizes the reservation **and** one usage ledger debit in a
  single atomic D1 batch transaction. Duplicate retries are idempotent.
  Remaining held capacity becomes spendable again. Zero measured usage
  finalizes with no debit.
- `releaseSyntheticCredits` requires an explicit
  `verifiedNoProviderCharge=true`. When the cost is uncertain after a
  timeout, do **not** call release or automatically expire a hold; hold
  until the provider bill or authoritative metering record is reconciled.
  A settled debit cannot be released by replay.
- Payment reversals on spent credits still require separate verified
  provider/money evidence. A synthetic refund after a hold may freeze its
  settlement; the transaction remains held until properly reconciled.
- Reporting through `readSyntheticSpendableCredits` separates wallet
  `availableCredits` from `heldCredits` and computed `spendableCredits`.
  This is **not the production customer credit balance**.

## Work deliberately not yet done

- This proof is not wired to model invocation, chat, image, voice,
  plugins, Tavily, subscription periods or production D1.
- No real OpenAI/Tavily invoice verification, account-level liability
  or provider rate card ingestion. The tests use *synthetic* rate fixtures.
- No timeout/background reaper: that could accidentally release credit for
  still-billed remote requests.
- No production checkout, auto-renewal, top-up, billing or refunds enabled.

## Test and deployment gates

Run `node --test tests/billing-synthetic-usage-reservations.test.js`.
The tests use `node:sqlite` in memory, apply staging migrations
0001–0007, mint an **in-memory synthetic ledger grant**, and check
worst-case cost, exact spend, retries, concurrent 40-request capacity,
protected direct usage, idempotent 0-cost settlement, forged/unmeasured
events, immutable rows and negative balance/reversal states.

When separately approved and reviewed, migration
`0007_synthetic_usage_reservations.sql` can be applied **only to the
dedicated staging D1** via the generated staging config after checking
the exact database UUID. It does not change production D1 and should
not be applied as part of a production Worker deploy. There is no
need to deploy the stage HTTP Worker for these module-only tests.

**Launch decision remains NO-GO until #317, #318 and #319 are all
implemented and verified against approved live dependencies.**
