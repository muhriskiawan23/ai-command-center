# BOR AI Adaptive Multi-Model Gateway

**Decision:** Adaptive Multi-Model is the default routing strategy.  
**Status:** Architecture specification plus implemented runtime gateway (PR #94, deployed). Phase A/B and one-provider adaptive routing are active; no external provider adapter is enabled.  
**Compatibility baseline:** `main` at `dcfa8c027e60b2fff262d8de8cdfc8225ffa6d7c` (PR #100 merged; manual bilingual evaluation planner added).

## 1. Repository audit and current baseline

The runtime is now a gateway-backed single-provider adaptive application. It supports adaptive policy evaluation and task-specific routing, but currently has only one eligible model candidate, so there is no live cross-provider choice yet.

Verified in `main` at the baseline SHA above:

- `src/model-gateway.js` defines versioned task profiles, validates model metadata and routing constraints, applies hard eligibility gates, and ranks eligible candidates.
- The existing Workers AI model `@cf/meta/llama-3.3-70b-instruct-fp8-fast` is the only eligible production candidate. No external provider credentials or adapters are active.
- `runAgent()` routes specialist calls through the gateway; task profiles are mapped by agent role.
- Web chat returns actual model trace metadata; Public API returns it in its response; Telegram shares the gateway path and emits internal structured telemetry without exposing model metadata in the chat message.
- Public API handling was corrected to preserve the string response returned by `runAgent()` and include model metadata.
- Existing timeout/cancellation, memory, locale, quota, output validation/retry and persistence behavior remain part of the request path.
- PDF conversion uses the separate `env.AI.toMarkdown()` binding and remains outside chat-model routing.

**Conclusion:** gateway phases A/B and one-provider adaptive routing are implemented and deployed. Multi-provider adaptive selection is not yet live because only one candidate is eligible; expanding the catalog requires verified capability evidence and explicit approval of provider, budget, data policy and consent.

## 2. Product policy: Adaptive by default

For every model call, select the best eligible model for the task under explicit constraints. Do not simply choose the cheapest model, the newest model, or the most expensive model.

Selection order:

1. Enforce hard eligibility: task capability, input modality, context size, structured-output/tool requirements, region and data-handling policy, provider availability, and user consent.
2. Enforce request constraints: remaining deadline, retry budget, user-selected mode/override, and per-user/global spend ceiling.
3. Rank eligible candidates using measured quality, reliability, latency and cost for the task and language.
4. Choose the highest-value eligible candidate. If quality is equivalent within the evaluation tolerance, prefer the lower-cost or lower-latency candidate according to the request's latency/cost objective.
5. If no candidate satisfies the hard constraints, fail clearly. Never silently downgrade a required capability or fabricate a result.

The default adaptive policy should be quality-aware and cost-conscious. It may use a fast/low-cost model for routine chat and translation, and a stronger model for difficult reasoning, coding, research synthesis or high-impact analysis when evaluation evidence supports that choice.

### User-facing modes

- **Adaptive (default):** automatically balance quality, reliability, latency and cost.
- **Quality-first (optional later):** prioritize quality subject to a configured hard spend ceiling.
- **Speed-first (optional later):** prioritize latency while preserving task capability and minimum quality.
- **Cost-first (optional later):** choose the lowest-cost model that meets a task-specific quality floor.

Do not expose modes until their behavior, limits and cost implications are implemented and tested. Adaptive remains the default unless the user explicitly changes it.

## 3. Target architecture

Keep application orchestration independent from provider-specific SDKs and model identifiers.

```text
Chat / Public API / Telegram
            |
      Request Context
  (auth, consent, locale, memory,
   quota, deadline, trace ID)
            |
     Agent Orchestrator
 (coordinator + specialist roles)
            |
     Task & Capability Contract
            |
   Adaptive Model Gateway
   |        |          |
 Catalog  Policy    Health/Telemetry
   |        |          |
 Candidate Eligibility + Scoring
            |
       Provider Adapter
       /      |       \
 Workers AI  Provider B  Provider C
       \      |       /
       Normalized Model Result
            |
  Existing validation / citations /
  persistence / response metadata
```

### Logical modules

1. **Model catalog** — versioned, configuration-driven records for each approved model.
2. **Task contract** — describes what the call must do, not which vendor it must use.
3. **Policy engine** — applies hard constraints and adaptive ranking.
4. **Provider adapters** — translate normalized requests/responses to provider-specific APIs.
5. **Health and circuit state** — track provider/model availability and recent failures.
6. **Budget manager** — enforces deadline, token, retry and monetary limits.
7. **Telemetry and evaluation** — record safe route metadata and measure task quality, latency, reliability and cost.

The first adapter is the existing Workers AI binding. External adapters are added one at a time after provider API, pricing, terms, regional availability, data retention, security and budget review.

## 4. Model catalog contract

Each model entry should declare at least:

- stable internal model ID and exact provider model/version ID;
- provider and adapter name;
- supported capabilities: text generation, reasoning profile, JSON/structured output, tool calling, vision, audio input/output, embeddings, and document support where verified;
- accepted modalities and file/input limits;
- context and output-token limits;
- supported languages or measured language-quality coverage;
- region/data residency and retention characteristics;
- whether provider training on submitted data is disabled/contractually controlled;
- availability state and operational status;
- measured quality by task/language, latency percentiles, error rate and reliability;
- input/output pricing and the date/source of the pricing record;
- evaluation version and last verification time.

Unknown capability, price, retention or regional facts must be treated as unknown, not assumed. A model must not be eligible for a capability that has not been verified.

## 5. Task contract and routing profiles

The orchestrator supplies a semantic task label and explicit requirements. Initial profiles:

| Task profile | Typical roles | Minimum requirements |
|---|---|---|
| `fast_chat` | coordinator, simple Q&A | text, low latency, Indonesian quality floor |
| `deep_reasoning` | analyst, strategist, critic | strong reasoning, adequate context |
| `research_synthesis` | researcher, fact checker, writer | long-context handling, evidence discipline |
| `coding` | coder | code reasoning; structured output when needed |
| `translation` | translator | verified target-language quality |
| `multimodal_vision` | image/document analyst | verified vision input capability |
| `audio` | speech tasks | verified audio capability |
| `structured_extraction` | document/data workflows | reliable schema-constrained output |

The profile must be chosen from the operation and declared requirements, not from superficial keyword matching alone. A coordinator may request a stronger profile when the task is complex, ambiguous or high impact. Specialist agents may use different models within one workflow.

## 6. Normalized gateway interface

Conceptual normalized interface (implementation is currently integrated through `runAgent()`):

```js
const result = await modelGateway.run({
  task: "deep_reasoning",
  messages,
  requirements: {
    capabilities: ["text"],
    minQualityTier: "high",
    maxInputTokens: estimatedInputTokens
  },
  constraints: {
    deadlineAt,
    maxAttempts,
    maxCost,
    dataPolicy: "approved-providers-only",
    userConsent: consentSnapshot
  },
  traceId
});
```

The normalized result should preserve the provider's useful output while adding:

- `response` / normalized content;
- `provider` and exact `model` actually used;
- `taskProfile` and routing-policy version;
- usage/token metadata when supplied by the provider;
- measured latency and retry/fallback count;
- trace ID and a safe failure classification.

Do not expose secrets, raw provider errors, private prompts or internal routing heuristics in client responses. Preserve backward compatibility for existing callers during migration.

## 7. Fallback, retries and failure semantics

Fallback is allowed only when the next candidate satisfies the same hard requirements and data policy.

- Retry transient network failures, provider 429 responses and eligible 5xx/timeouts within the shared request deadline and retry budget.
- Do not retry invalid requests, authentication/permission failures, policy denials, unsupported capability errors or malformed user input with another provider.
- Do not fall back to a model that lacks required vision/audio/tool/structured-output capability.
- Never cross a data-handling or consent boundary during fallback.
- Use bounded exponential backoff with jitter where it fits the remaining deadline.
- Maintain provider/model circuit breakers to avoid repeatedly selecting a known unhealthy route.
- Avoid retrying a completed generation after downstream persistence failure unless the idempotency contract proves it is safe.
- Return a clear, localized unavailable response when no eligible candidate remains.

Model generation is currently read-only, but any future tool execution must remain outside provider retry logic. A model retry must never duplicate an external write.

## 8. Privacy, security and governance

- Workers AI remains the initial default route.
- External providers are disabled until the founder approves the provider, budget, data policy and user-facing disclosure/consent behavior.
- Do not send memory, conversation history, uploaded files or personally sensitive content to a new provider by default.
- Apply data minimization per task; send only the context needed for that call.
- Provider credentials stay in the platform secret manager, never in source, browser code, logs or chat.
- Treat model output as untrusted; keep existing citation validation, output checks and tool permission boundaries.
- Do not allow provider responses or model metadata to modify routing policy, secrets, user permissions or budgets.
- Record provider/model and policy version without logging raw prompts or private file content.
- Ensure deletion/retention rules apply consistently across provider logs and subprocessors.

## 9. Cost and quality controls

A request budget must include every agent call, retry and fallback, not merely one user message.

- Keep the existing request deadline, cancellation and daily quota behavior.
- Add provider-specific token and monetary ceilings, per-user limits and global spend ceilings before enabling external billing.
- Estimate cost before a call when token/pricing data is available; reconcile with actual usage after a call.
- If usage or price is unavailable, apply a conservative configured ceiling or disable that route.
- Measure quality using task-specific, human-reviewed evaluation sets, including Indonesian and English. The initial bilingual fixture is in evaluation/model-quality-cases.json; validate it with npm run eval:validate.
- Keep fixture validation, mocked integration tests, human-reviewed model outputs and live provider results as separate evidence classes.
- Compare cost per successful task, not only cost per token.
- Keep separate results for mocked tests, provider integration tests and live production verification.

## 10. Workers AI candidate inventory (audit only)

The current production catalog remains limited to the existing Llama 3.3 70B model. The official Workers AI catalog audit and candidate shortlist are documented in `docs/WORKERS-AI-MODEL-INVENTORY.md`. The shortlist includes Granite 4.0 H Micro, GLM-4.7-Flash, SEA-LION v4 27B and GPT-OSS-20B. Their documented capabilities, context, zero-data-retention labels and reference prices are not live BOR AI measurements. No candidate is enabled by this audit; account access, request compatibility, billing, latency and Indonesian/English quality must be verified before runtime eligibility.

## 11. Migration plan

### Phase A — Contract and tests

**Status: implemented**
- Task profiles, model catalog validation, normalized selection policy and hard eligibility checks are implemented in `src/model-gateway.js`.
- Automated tests cover selection, malformed metadata/constraints, provider approval, deadline/budget gates and model output limits.

### Phase B — Compatibility seam

**Status: implemented**
- The gateway is integrated behind the shared `runAgent()` path.
- Existing agent prompts, output validation/retry, memory and locale wrappers remain in place.
- Actual provider/model trace metadata is propagated through web chat, Public API and Telegram.
- Public API string-response handling is covered by regression tests.
- PDF `toMarkdown()` processing remains separate.

### Phase C — Adaptive routing with one provider

**Status: deployed**
- Adaptive policy runs with the existing Workers AI model as the sole eligible candidate.
- PR #94 was merged as `c64b8fdfdf5c2079ccfd242a43dc2c735496532b` and deployed as Worker version `02726d6c-1372-4e43-8f85-00e4a73eb43f`.
- Post-deploy health, agents and Google sign-in configuration checks passed. Production D1 was verified read-only; no migrations were pending.
- Each model-agent call emits a structured BOR_AI_MODEL_TELEMETRY log with provider/model, task profile, policy version, outcome, elapsed time and retry count. Logs exclude prompts, responses, user IDs and provider payloads; durable dashboards/retention are not configured.
- Web chat and Public API trace metadata now include per-agent elapsed time, retry count and outcome. Telegram uses the same safe structured log path.
- A bilingual offline benchmark fixture and human-scoring protocol are maintained in evaluation/model-quality-cases.json and docs/MODEL-QUALITY-EVALUATION.md; no live model quality score is claimed.

### Phase D — Second provider pilot
- Select one official provider only after a founder-approved budget and data policy.
- Add one adapter and a narrow opt-in task profile first.
- Run shadow/offline evaluation before live traffic; then limited opt-in traffic with spend caps and rollback.
- Expand only if quality, reliability, privacy, latency and cost improve on measured tasks.

### Phase E — Multi-provider adaptive operation
- Add candidates gradually, with per-model capability verification and routing evaluations.
- Re-evaluate weights and thresholds from measured outcomes.
- Keep provider selection observable and allow a safe global disable switch.

## 12. Acceptance and regression gates

Required automated tests:

- catalog schema validation and rejection of unknown capabilities;
- deterministic selection under fixed inputs;
- no selection of a model that fails modality, context, region, consent or budget constraints;
- task/language quality floor and cost/latency tie-break behavior;
- transient-only retry and eligible fallback;
- no fallback on authentication, policy or invalid-request failures;
- deadline, cancellation, backoff and total-attempt limits;
- circuit-breaker open/half-open behavior;
- correct actual provider/model metadata for each specialist in a multi-agent workflow;
- compatibility for web chat, public API and Telegram;
- no regression to memory, localization, quota, idempotency, output validation or persistence behavior;
- no prompt, file content, credential or sensitive user data in telemetry;
- no external provider call without the approved consent/data policy.

Release gates:

- Unit, integration, E2E, security and preview checks pass on the exact PR head.
- Existing behavior is compared against a baseline fixture.
- External provider tests are clearly separated from mocked tests.
- A live provider test requires approved credentials and budget.
- No merge, production deployment, production secret change or paid-provider activation without explicit founder approval.

## 13. Decisions still requiring founder approval

The Adaptive strategy is selected, but the following remain deliberately undecided:

- which second model provider to pilot;
- maximum monthly and per-user inference spend;
- whether external providers may process conversation history, memory and uploaded files, and the consent model;
- whether users can manually override the adaptive choice;
- which quality/latency/cost trade-off thresholds should be used after benchmark evidence exists.

Until these decisions are approved, the safe default is one-provider adaptive routing (the existing Workers AI model remains the only eligible model), not speculative multi-provider activation.
