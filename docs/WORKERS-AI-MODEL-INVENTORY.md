# Workers AI Model Inventory

**Audit date:** 2026-11-08  
**Repository baseline:** `7a95c7e210c1693bf956d2665501dec0d80d9ce5`  
**Scope:** Official Cloudflare Workers AI-hosted text-generation candidates only. This is an inventory, not a runtime allowlist.

## Executive summary

The production gateway currently has one configured candidate: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The official Workers AI catalog currently lists 73 models across task types. Four text-generation candidates are prioritized for offline and controlled benchmark evaluation because their published capabilities, context, data-retention label and pricing are documented.

**No candidate is enabled in the runtime catalog by this audit.** Catalog presence and a published model page do not prove that the BOR AI account has access, that all request parameters match the current adapter contract, or that quality/latency are suitable. Do not route production traffic to any candidate until the preflight and benchmark gates below pass.

## Current baseline and shortlist

Prices below are USD per one million input/output tokens, as published by Cloudflare's pricing/model pages at audit time. They are reference rates, not a prediction of BOR AI's bill. Actual billing is in Neurons, with a daily free allocation and paid usage rules described by Cloudflare.

| Model ID | Published context | Published capabilities / notes | Published data label | Input / output price | Evaluation priority |
|---|---:|---|---|---:|---|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (current) | Not re-recorded in this inventory | Existing production baseline; text generation | Re-check model page before recording | $0.293 / $2.253 | Baseline |
| `@cf/ibm-granite/granite-4.0-h-micro` | 131,000 | Text generation; function calling; positioned for instruction following, RAG and multi-agent workflows | Zero data retention | $0.017 / $0.112 | P1: low-cost control |
| `@cf/zai-org/glm-4.7-flash` | 131,072 | Text generation; reasoning; function calling; multilingual (Cloudflare describes 100+ languages) | Zero data retention | $0.0605 / $0.400 | P1: general chat and tool-use |
| `@cf/aisingapore/gemma-sea-lion-v4-27b-it` | 128,000 | Text generation; SEA-LION family is pretrained/instruction-tuned for Southeast Asian languages | Zero data retention | $0.351 / $0.555 | P1: Indonesian/SEA-language quality |
| `@cf/openai/gpt-oss-20b` | 128,000 | Text generation; reasoning; function calling; lower-latency/specialized positioning | Zero data retention | $0.200 / $0.300 | P2: reasoning/coding comparison |

### Why these candidates

- **Granite 4.0 H Micro** is a low-cost comparison point. Its low published token rates make it worth testing for routine chat and orchestration, but cost alone is not evidence of adequate Indonesian quality.
- **GLM-4.7-Flash** has explicit multilingual, reasoning and function-calling positioning with a published 131k context. It is the strongest first general-purpose challenger to test against the baseline.
- **SEA-LION v4 27B** is particularly relevant to BOR AI's Indonesian and Southeast Asian audience. The model family positioning is promising, but actual Indonesian quality must be measured using BOR AI's own bilingual cases; do not assume Indonesian superiority from the family name.
- **GPT-OSS-20B** offers reasoning/function-calling support and a materially lower published token price than the current 70B baseline. Test instruction adherence, reasoning and code quality before considering it for specialist routing.

## Pricing and platform constraints

Cloudflare's Workers AI pricing page states that billing is measured in Neurons, currently priced at $0.011 per 1,000 Neurons above the 10,000-Neuron daily free allocation on Workers Paid. Limits reset daily at 00:00 UTC; exceeding a limit can cause further operations to fail. Some frontier models require a paid billing method. Confirm the account plan, current quota and dashboard usage before running repeated benchmarks or enabling traffic.

Do not calculate a production budget by multiplying token estimates by these reference rates alone. Confirm actual Neuron usage and returned usage metadata for each tested model, including retries and all specialist calls.

## Preflight checklist before any live candidate call

1. Confirm the exact model ID is still listed and not deprecated on the official catalog.
2. Confirm the model is accessible to the BOR AI Cloudflare account and its current billing/Neuron requirements.
3. Confirm the current Workers AI binding accepts the exact `messages` payload and generation parameters used by `runAgent()`.
4. Verify response shape, finish reason, usage metadata, streaming behavior (if used), cancellation and timeout behavior.
5. Verify the model's current context/output limits and function-calling/structured-output behavior; never infer undocumented limits.
6. Review the model page's data-retention label and Cloudflare's applicable data-usage terms. Zero-data-retention is a useful provider-published control, not a substitute for BOR AI's own privacy review and user-facing policy.
7. Set a small, explicit test budget and maximum call count. Record model ID, timestamp, task, language, latency, outcome, retries and usage only; do not persist prompts or responses in telemetry.
8. Keep the candidate disabled for production routing until benchmark review and founder approval.

## Benchmark plan

Use the existing bilingual fixture in `evaluation/model-quality-cases.json` as the initial baseline, then expand it before claiming comparative quality:

- At least three independent runs per case and model.
- Same system instructions, input, output-token cap and generation settings where supported; document unavoidable model-specific differences.
- Score blind on correctness, completeness, instruction adherence, reasoning, Indonesian/English naturalness, hallucination discipline and safety.
- Add cases for Bahasa Indonesia colloquial/business language, finance arithmetic, source-grounded research, multi-turn context, JSON schema adherence, tool-call arguments, coding correctness and prompt-injection resistance.
- Report per-task/per-language mean and variance, failure rate, p50/p95 latency, retries, tokens/Neurons and cost per successful task.
- Compare all candidates to the current Llama 3.3 70B baseline. Do not let one aggregate score hide a weak Indonesian or safety result.
- Treat offline/manual benchmark results separately from live production reliability.

No benchmark calls or model-quality scores were generated by this inventory-only change.

## Decision status

| Item | Status |
|---|---|
| Official catalog presence | Verified from Cloudflare documentation on 2026-11-08 |
| Published model IDs, context and data-retention labels | Verified for shortlisted models |
| Published reference pricing | Verified from Cloudflare pricing documentation |
| BOR AI account entitlement / live invocation | Not verified |
| BOR AI Indonesian/English quality scores | Not measured |
| Production runtime catalog changes | None |
| Production routing / traffic / secrets / migrations | Unchanged |

**Recommendation:** start with GLM-4.7-Flash, Granite 4.0 H Micro and SEA-LION v4 27B in a bounded offline/controlled evaluation alongside the current baseline. Add GPT-OSS-20B as the reasoning comparison. Do not activate any candidate in production solely from this inventory.

## Official sources

- Workers AI model catalog: https://developers.cloudflare.com/workers-ai/models/
- Granite 4.0 H Micro: https://developers.cloudflare.com/workers-ai/models/granite-4.0-h-micro/
- GLM-4.7-Flash: https://developers.cloudflare.com/workers-ai/models/glm-4.7-flash/
- SEA-LION v4 27B: https://developers.cloudflare.com/workers-ai/models/gemma-sea-lion-v4-27b-it/
- GPT-OSS-20B: https://developers.cloudflare.com/workers-ai/models/gpt-oss-20b/
- Workers AI pricing: https://developers.cloudflare.com/workers-ai/platform/pricing/
