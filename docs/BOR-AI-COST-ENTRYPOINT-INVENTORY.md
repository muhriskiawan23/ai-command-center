# BOR AI — cost-bearing entrypoint inventory (static review, paid features OFF)

**Scope:** review reminder only. This is NOT verified live token metering, merchant billing, a complete program call graph or a security guarantee. No production requests, payments, network operations or migrations are run by the accompanying tests.

## Entrypoints requiring coverage before paid activation

| Entry | Current invocation path | What paid launch must meter/guard |
| --- | --- | --- |
| Web chat `POST /api/chat` | `src/index.js` -> `runAgent` or `runMultiAgent` -> Workers AI | Every model attempt, retries and all specialist passes, pre-reserved wallet/provider budget, measured usage, no double debit |
| Developer API `POST /api/public/chat` | `src/widget-api.js` -> injected `runAgent` | Per-API-key and account identity, bypass prevention, atomic credit/provider budget |
| Telegram `POST /api/integrations/telegram/webhook` | `src/telegram.js` -> `runAgent` or `runMultiAgent` | Identity mapping, bounded retries, customer authorization and spend cap |
| PDF converter `POST /api/documents/pdf` | `src/index.js` -> `env.AI.toMarkdown` | Assess conversion costs separately from normal LLM tokens; do not assume every format/route is always free |
| Research tools | `src/research.js` (`searchExternal`), `src/tavily-extract.js` (`extractWithTavily`) | Separate provider/Search/Extract credits, timeout/retry costs and privacy approval |

`src/index.js` currently has four textual `env.AI.run(...)` callsites, including wrappers that delegate to the actual model caller; **this does not mean four model calls per request**. It also has a direct `env.AI.toMarkdown` entry. A new/renamed callsite fails the offline inventory test and requires review. Static source markers cannot detect all dynamically constructed provider calls.

Cloudflare states that `toMarkdown` is free for most conversions, while some conversions using Workers AI models may incur charges; applicability and the actual merchant account cost must be verified. Source: https://developers.cloudflare.com/workers-ai/features/markdown-conversion/

## No-go conditions

- Draft Stage 3 provider usage journal, D1 ledger, budget and gateway adapter PRs **remain isolated**; no live customer charging authorization.
- Current Free quota units are not measured tokens or customer paid credits.
- Actual Worker AI token counts/usage shape, all retries, tool cost and provider invoices require explicitly approved bounded staging proof.
- Each entrypoint and each potential tool call must fail closed on absent tariff, missing reservation, unverified provider usage or authoritative payment status. No customer response or credit grant should bypass settlement policy.
- Independently review #253 and #156 requirements before any production migration or paid activation.

The test `tests/ai-cost-entrypoint-inventory.test.js` is a drift alert for this map, not a substitute for integration tests, a call-graph analyzer or a live audit.
