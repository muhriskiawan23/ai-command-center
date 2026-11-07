# BOR AI Adaptive Multi-Model Gateway

**Decision:** Adaptive Multi-Model is the default routing strategy.  
**Status:** Architecture specification only; no runtime gateway or provider integration is implemented by this document.  
**Compatibility baseline audited:** `main` at the repository's current default branch during this audit.

## 1. Repository audit and current baseline

The current implementation is a single-model Workers AI application with multi-agent orchestration, not a multi-model application.

Verified in the current `main` source:

- `src/index.js` declares one global model constant: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`.
- `runAgent()` invokes `env.AI.run(MODEL, ...)`; every specialist role therefore uses the same model today.
- The multi-agent workflow sequences specialist roles (Researcher, Analyst, Fact Checker, Writer and others), but role separation does not currently imply model/provider separation.
- `withAiDeadline()` wraps the Workers AI binding with per-call timeout, request deadline and cancellation handling.
- `withSystemExtra()` and `withResponseLanguage()` wrap the same AI binding to add memory context and response-language instructions. These are middleware-like request transformations, not provider routing.
- Web chat, the public widget/API and Telegram ultimately reuse `runAgent()` and/or `runMultiAgent()`, so a gateway placed at this shared execution seam can cover all three entry points without duplicating routing logic.
- The public API returns `MODEL` as metadata; the normal chat path also reports `MODEL`. Those fields would become misleading if different agents could use different models.
- PDF conversion uses the separate `env.AI.toMarkdown()` binding. It is a document-conversion capability, not a chat-model call, and must remain separate unless a later audit explicitly justifies abstraction.
- `wrangler.jsonc` currently configures one Workers AI binding named `AI`; no external model-provider bindings, model catalog, provider registry, capability registry, routing policy, health registry, or model fallback implementation was found in the inspected runtime configuration/source.
- Existing safeguards include request cancellation, per-call and total multi-agent deadlines, daily usage accounting, public API quotas, and output validation/retry. A gateway must preserve and integrate with these safeguards rather than bypass them.

**Conclusion:** the first gateway milestone is an abstraction and compatibility refactor around the existing Workers AI call path. It is not a simultaneous migration to several paid providers.

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

Proposed conceptual interface (not implemented yet):

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
- Measure quality using task-specific, human-reviewed evaluation sets, including Indonesian and English.
- Compare cost per successful task, not only cost per token.
- Keep separate results for mocked tests, provider integration tests and live production verification.

## 10. Migration plan

### Phase A — Contract and tests
- Define task profiles, catalog schema, normalized result/error contract and deterministic policy.
- Add fixtures for current Workers AI behavior and preserve the current model as the only eligible production candidate.
- Test selection, hard constraints, deadline/cancellation, quotas, metadata and compatibility.

### Phase B — Compatibility seam
- Introduce the gateway behind the shared `runAgent()` path.
- Preserve all existing agent prompts, token limits, output validation/retry, memory and locale middleware.
- Propagate actual provider/model metadata through web chat, public API and Telegram.
- Keep PDF `toMarkdown()` processing separate.

### Phase C — Adaptive routing with one provider
- Enable the policy with the current Workers AI model as the sole eligible candidate.
- Verify that the gateway is behaviorally equivalent to the current path before adding another provider.
- Add telemetry and evaluation reporting.

### Phase D — Second provider pilot
- Select one official provider only after a founder-approved budget and data policy.
- Add one adapter and a narrow opt-in task profile first.
- Run shadow/offline evaluation before live traffic; then limited opt-in traffic with spend caps and rollback.
- Expand only if quality, reliability, privacy, latency and cost improve on measured tasks.

### Phase E — Multi-provider adaptive operation
- Add candidates gradually, with per-model capability verification and routing evaluations.
- Re-evaluate weights and thresholds from measured outcomes.
- Keep provider selection observable and allow a safe global disable switch.

## 11. Acceptance and regression gates

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

## 12. Decisions still requiring founder approval

The Adaptive strategy is selected, but the following remain deliberately undecided:

- which second model provider to pilot;
- maximum monthly and per-user inference spend;
- whether external providers may process conversation history, memory and uploaded files, and the consent model;
- whether users can manually override the adaptive choice;
- which quality/latency/cost trade-off thresholds should be used after benchmark evidence exists.

Until these decisions are approved, the safe default is one-provider adaptive routing (the existing Workers AI model remains the only eligible model), not speculative multi-provider activation.
