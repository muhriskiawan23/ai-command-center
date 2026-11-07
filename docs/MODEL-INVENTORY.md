# BOR AI Model Inventory

**Audit date:** 2026-11-08  
**Scope:** Cloudflare Workers AI text-generation candidates only.  
**Activation:** No candidate is added to the production routing catalog by this inventory.

## Current production baseline

| Model | Context | Input / output price per 1M tokens | Verified platform features |
|---|---:|---:|---|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 24,000 | $0.293 / $2.253 | Text generation, function calling, batch, zero data retention |

This is the only model currently listed in `BASELINE_MODEL_CATALOG` and the only eligible production candidate. Price and context are platform-published values; BOR AI has not independently benchmarked its quality.

## Shortlist for offline evaluation

| Candidate | Context | Input / output price per 1M tokens | Why evaluate it | Current status |
|---|---:|---:|---|---|
| `@cf/aisingapore/gemma-sea-lion-v4-27b-it` | 128,000 | $0.351 / $0.555 | Specifically trained for Southeast Asian languages; Cloudflare documents Indonesian support and zero data retention | Evaluation candidate only |
| `@cf/openai/gpt-oss-20b` | 128,000 | $0.200 / $0.300 | Lower-latency reasoning model with function calling and configurable reasoning effort | Evaluation candidate only |

Official references:
- [Current Llama 3.3 model card](https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/)
- [SEA-LION v4 27B model card](https://developers.cloudflare.com/workers-ai/models/gemma-sea-lion-v4-27b-it/)
- [GPT-OSS 20B model card](https://developers.cloudflare.com/workers-ai/models/gpt-oss-20b/)
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

## Findings and limits

1. SEA-LION is the first language-quality candidate to test against the current model for Indonesian and other Southeast Asian languages. Its published language support is not proof of BOR AI task quality.
2. GPT-OSS 20B is a candidate for reasoning, coding and multi-agent specialist tasks. Published reasoning/function-calling capabilities do not prove it will outperform the baseline under BOR AI prompts.
3. Both candidates are still within Cloudflare Workers AI. This is a same-platform multi-model pilot, not an external-provider integration.
4. Do not populate measured quality, reliability or p95 latency fields from vendor claims. Measure them with the BOR AI evaluation set and actual platform responses.
5. Do not add either candidate to `BASELINE_MODEL_CATALOG`, run paid live comparisons, or route user traffic until the founder approves the experiment budget and data-handling policy.

## Recommended evaluation order

1. Compare baseline vs SEA-LION on Indonesian instruction-following, fluency, summarization, translation and factual restraint.
2. Compare baseline vs GPT-OSS 20B on multi-step reasoning, coding, structured output and instruction adherence.
3. Repeat each case enough times to estimate variance; use blind human scoring and retain exact model IDs, date, settings, token usage and latency.
4. Promote a candidate only if it meets hard safety/capability requirements and demonstrates better task quality or cost per successful task.
