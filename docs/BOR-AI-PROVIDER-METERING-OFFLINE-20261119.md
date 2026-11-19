# BOR AI — strict offline provider-usage accounting bridge

**STATUS: proof only. Not imported by production Worker, no live API calls,
no billing activation, no entitlement, no Cloudflare D1 deployment.**

This review follows the successful isolated staging Sandbox callback replay
and the synthetic credit reserve/settle proof (#322), while production
Duitku merchant approval remains pending.

## What the current BOR AI production source actually does

- `src/index.js` uses Cloudflare Workers AI `env.AI.run` and a
  configurable OpenAI text backup/failover.
- `src/text-inference-budget.js` reserves estimated AI cost against a
  **global daily provider budget** using a byte-based input estimate,
  max output tokens and a hardcoded rate map. This is not a per-user
  subscription credit debit and is not an audited actual bill.
- `src/text-provider-failover.js` likewise reserves global OpenAI
  backup budget using a hardcoded rate pair and can return text without
  checking/persisting `result.usage`. An ambiguous timeout correctly
  retains its reserve but no customer accounting link exists.
- `src/tavily-extract.js` reserves **global extraction attempts**;
  it does not establish the invoice-level provider credits actually
  charged for each customer; API success/results are not independent
  monetary evidence. The global cap defaults to zero.
- Staging billing migrations `0007` and `0008` and their pure modules
  are still **not remotely deployed**, and all their test credits are
  synthetic. Do not silently reuse the independent D1 staging database
  for real signed-in BOR AI users.

## New proof in this change

`src/billing-provider-metering-offline.js` implements two narrow,
strict provider-token receipt adapters and an offline orchestration proof:

1. **OpenAI Chat Completions nonstream response:** requires a server-pinned
   `model`, `object='chat.completion'`, bounded `chatcmpl-...` ID,
   nonnegative integral `usage.prompt_tokens`,
   `usage.completion_tokens` and
   `usage.total_tokens=prompt+completion`. Missing partial or
   streaming-final usage fails closed. Optional cached tokens are
   conservatively charged at the full input rate until a documented,
   versioned discount rate can be reconciled. Nonzero audio token
   subfields are blocked as an unpriced modality.
2. **Cloudflare Workers AI nonstream response:** requires the same
   integral token triple, with model identity supplied by the
   **trusted server-owned AI binding invocation**. If a model field
   is present it must match exactly. Some Workers AI models/paths may
   omit usage or bill by non-token units; those cannot settle from
   this proof and require a separate billing adapter/receipt.
3. **Offline hold->invoke->settle:** `simulateOfflineMeteredModelCall`
   requires an injected server-owned `invoke` function and explicit
   positive-rate snapshot. It first reserves the **maximum** model
   token budget with staging D1 migration `0007`, then invokes the
   synthetic adapter once. A verified, bounded usage triple finalizes
   exactly one ledger usage debit, releasing unused reserved credits.
   Duplicate request IDs never call the provider again.
4. **Uncertain cost** from a failed/timed-out provider call, missing
   usage, model/identity mismatch, streaming partial usage, over-cap
   usage or SQL failure leaves the hold outstanding for independent
   operator reconciliation. The module returns a sanitized status
   and never logs model prompts, user content, raw provider errors,
   billing tokens or API credentials.

**Crucial trust boundary:** A caller can fabricate a Javascript
`providerResponse` in a unit test; this proof is safe only when a
reviewed server path independently authenticates the customer,
pins the actual provider/model/rate version, injects the trusted
provider transport and correlates the response with exactly that call.
There is **no public endpoint** using this module and no production
claims of provider authenticity. Do not accept client-submitted usage.

## Tavily and non-text tools: intentionally unresolved

Tavily search/extract provider credits cannot be inferred safely from
arbitrary result counts, HTTP 200 responses or browser assertions.
For live settlement, fetch an authoritative provider billing/usage
record (or a separate merchant-reviewed per-attempt tariff contract),
handle search and extract differences, and reserve a worst-case
per-tool limit. Until then this module rejects
`tariff.maxToolCredits>0` and never treats Tavily usage as free.
Images, voice, PDF, premium models, agents and plugin usage require
independent cost meters and server caps.

## Tests / deployment

New tests in `tests/billing-synthetic-usage-reservations.test.js`
apply staging migrations to **in-memory SQLite**, with a fully synthetic
user, quote and test credit grant. They validate strict OpenAI/Workers
usage schemas, caching conservatism, mispriced audio, missing usage,
fake model/ID, malformed counts, double invocation under replay,
provider exceptions, over-cap usage and unsupported tools.

**Do not apply migrations 0007/0008 remotely or deploy a Worker
as part of this change.** Production checkout/credits stay disabled.

## Source API usage shapes (reviewed November 2026)

- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://developers.cloudflare.com/api/resources/ai/methods/run/
- https://help.tavily.com/articles/8298987937-billing-credits-usage-limits
- https://help.tavily.com/articles/6938147944-basic-vs-advanced-search-what-s-the-difference

## Remaining P0 launch gates

- Duitku merchant/channel/contract and first **pending→paid** verified callback.
- Production per-user authenticated credit wallet and reservation adapter:
  no live entitlement or subscription activation exists today.
- Actual provider/model dynamic pricing, cached rates, multi-agent,
  Workers AI neuron/non-token units, image/audio + Tavily/other plugin costs.
- Provider invoice/usage reconciliation on ambiguous requests,
  hard caps, audit/alerts and formal retry policies.
- Real refund/chargeback financial evidence and customer cancellation
  + legal/consumer terms; the existing synthetic reversal is not a refund.
- Staged security review, deployment rollback and merchant go-live
  approval. Refer to #317, #318, #319.
