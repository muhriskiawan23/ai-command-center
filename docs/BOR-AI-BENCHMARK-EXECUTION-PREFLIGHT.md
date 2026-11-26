# BOR AI benchmark execution preflight

Prepared 26 November 2026 WIB. Candidate `af5dd9b473576affbcc269b90b28e852d506ca82`. Existing staging read-back and blocked-deployment evidence remain in [runner recovery](./BOR-AI-CLOUDFLARE-RUNNER-RECOVERY.md). The connector, preview and staging were left unchanged. This plan generated no provider requests.

## Preferred path: BOR AI staging integration

1. Verify that the independently authorized runner uses the exact candidate, an isolated non-production database, managed OpenAI and operator credentials, staging-only routing, and a working kill switch. Verify authenticated access without triggering inference. The previous blocked upload is out of scope.
2. Inspect the durable campaign ledger and confirm there is no reservation, completed request, or uncertain in-flight result from any route for this benchmark. Obtain an atomic single-use claim in that ledger. Reserve no more than US$0.50 across both model-only and integration routes combined. The integration split remains US$0.24 for chat and its classifier, plus US$0.26 for one search attempt. Disable paid fallback and retries for the campaign.
3. Reuse `evaluation/answer-quality-smoke.json` in order. Check the actual candidate version, real login and history, automatic routing, safety and quota boundaries, usage receipts and official citations. Keep the existing benchmark and browser gates. Restore staging to its safe state after the approved run. Production remains gated on the full passing suite and verified cost reconciliation.

## Fallback: standalone model and provider

Generate an offline manifest from the repository root with Node 22+:

```bash
node evaluation/prepare-answer-quality-api.js > /tmp/bor-answer-quality-api-plan.json
```

The manifest contains six exact synthetic scenarios, seven response requests, one tool-enabled request with one tool call, an explicit prior-turn dependency for the follow-up, disabled storage and truncation, and per-step output and input limits. Six text steps reserve US$0.04 each, and the search step reserves US$0.26. These are admission reservations. The script only reads the fixture and writes JSON. It never opens a network connection, reads a secret, creates a reservation, or calls OpenAI.

Before sending the manifest from an authorized execution environment:

1. Verify the existing staging-project credential is available through the environment's secret manager as `OPENAI_API_KEY` and that direct egress to the official OpenAI API is permitted. Confirm project scope and access to `gpt-6-luna`. No secret in shell arguments, the manifest, chat or logs.
2. Select the model-only route in the same durable one-shot campaign ledger before making requests. If the integration route was already claimed or spend cannot be reconciled, halt. Do not assume a Cloudflare app ledger and an isolated local file coordinate automatically. Keep an independent approved limit for each admitted request using current standard-tier pricing.
3. Run each step serially. On the follow-up only, prepend the prior synthetic user message and its actual assistant answer. Validate the full input with the official input-token counter against the 10,000-token application limit before sending. Use the exact manifest caps for output tokens and one Web Search tool call. Send one request per admitted step. On timeout, missing usage, unrecognized model, unexpected tool activity, or a material quality failure, stop and keep the reservation until reconciliation. Never replay an uncertain request.
4. Record the scenario, request/response IDs, model ID, duration, usage, tool usage and citation annotations. Independently verify sources, then score each case against the existing reference and rubric. Reconcile provider usage and billed charges before authorizing any other phase against the shared US$0.50. Report results as model/provider evidence. BOR AI integration and release gates remain separate.

Official references: [Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna), [input-token counting](https://developers.openai.com/api/docs/guides/token-counting), [hosted Web Search](https://developers.openai.com/api/docs/guides/tools-web-search?api-mode=responses), [standard API pricing](https://developers.openai.com/api/docs/pricing).

## Evidence and minimum remaining intervention

Local verification passed for syntax, fixture blob identity, exact turn count, bounded reservation and Web Search, prior-turn dependency and fail-closed route drift. Verified script Git blob `f2fc213d660fac888b604cb63cd4944bc34e291c`. Existing offline application tests were not rerun.

Current connected tools expose no authorized candidate integration runner and no direct API executor with an existing managed credential. If the owner can provide a permitted runner, the one step is to attach their existing staging-project credential in the approved runner's secret manager as `OPENAI_API_KEY` and share only the runner name/URL. Staging integration remains preferred if its exact candidate and guards become available. No API key creation, credential transfer, budget reset, staging mutation or production deployment.
