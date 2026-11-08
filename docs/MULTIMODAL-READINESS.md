# BOR AI Multimodal Model Readiness

**Audit date:** 2026-11-09  
**Scope:** Public Cloudflare Workers AI model catalog and repository readiness only.  
**Runtime status:** Text-only baseline remains the sole eligible production model. No vision, audio, or video model is enabled or called by this audit.

## Executive summary

The repository has a task profile for vision, but the production catalog currently contains only the text baseline `@cf/meta/llama-3.3-70b-instruct-fp8-fast`. The frontend does not yet provide image understanding, audio input/output, or video analysis. Local PDF/CSV/XLSX/PPTX extraction is separate from multimodal model inference.

Cloudflare's current public catalog lists several potentially useful vision-capable Workers AI models. This inventory is a paper shortlist only: catalog presence and published pricing do not prove account entitlement, model-specific payload compatibility, actual usage cost, Indonesian quality, latency, or production suitability. No model has been selected, enabled, or invoked.

## Vision candidate shortlist

Published rates below are Cloudflare's per-million-token reference prices at audit time. Workers AI billing is measured in Neurons; actual account cost and quota must be verified before any live call.

| Candidate | Published capabilities | Context | Input / output reference price | Initial role |
|---|---|---:|---:|---|
| `@cf/meta/llama-4-scout-17b-16e-instruct` | Vision, function calling, batch | 131,000 | $0.27 / $0.85 per 1M tokens | General image understanding plus agent workflows; review model license and data terms |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | Vision, function calling | 128,000 | $0.351 / $0.555 per 1M tokens | Cost-balanced text + image comparison |
| `@cf/moondream/moondream3.1-9B-A2B` | Image-to-text: query, caption, OCR-oriented visual reasoning, point, detect | Model page does not publish a comparable chat context window | $0.30 / $1.00 per 1M tokens | Specialized OCR/object detection and visual extraction; not a general chat replacement |
| `@cf/qwen/qwen3.8-27b` | Vision, reasoning, function calling, batch, zero-data-retention label | 262,144 | $0.45 / $3.20 per 1M tokens | Higher-capability multimodal/agentic comparison; output rate is materially higher |

A separate legacy option, `@cf/meta/llama-3.2-11b-vision-instruct`, is listed for visual recognition and image reasoning, but its model page requires accepting Meta's license/AUP before normal use. Do not make that activation request as part of a readiness audit.

### Selection guidance

- Start the *paper evaluation* with Llama 4 Scout and Mistral Small 3.1 as general vision candidates; compare Moondream for specialized OCR/detection and Qwen 3.8 as the higher-cost reasoning/agentic option.
- This is not a production selection or approval. Re-check current model IDs, license terms, data-retention labels, rate limits, and prices immediately before a controlled pilot.
- Do not infer Indonesian visual/OCR quality from model-family descriptions. Add Indonesian and English image tasks and score them blind against a reviewed rubric.

## Required preflight before any live inference

1. Confirm the exact model is still listed, supported, and accessible to the BOR AI Cloudflare account.
2. Confirm Workers AI plan, Neuron allowance, any paid billing requirement, per-model limits, and an explicit inference budget/call ceiling.
3. Read the exact model's current input schema. Confirm image content representation (URL, base64/data URI, or other format), accepted MIME types, maximum bytes, image count, dimensions, and whether streaming/tool calling work with image input. Do not copy a payload shape from another model.
4. Confirm the model's license/AUP and provider data-handling label. A published zero-data-retention label is a useful control, not a complete BOR AI privacy review.
5. Validate the response schema, refusal/error behavior, timeouts, cancellation, usage metadata, and whether image tokens count toward context and cost.
6. Run only in an isolated, approved environment after the account owner approves the spend ceiling and data policy. The offline benchmark planner does not authorize a provider call.

## Proposed product path (not implemented)

1. **Secure image intake:** one image initially; allowlisted MIME sniffing, byte and pixel caps, safe decode, dimension normalization, metadata removal where appropriate, and rejection of malformed/animated or decompression-bomb inputs.
2. **Explicit user action:** send image bytes only when the user deliberately attaches an image and submits a question. Do not fetch arbitrary remote image URLs from the browser without the existing SSRF-safe link controls.
3. **Ephemeral processing:** keep raw image bytes in request memory only; do not persist uploads or image embeddings by default. Avoid logging image payloads, base64, prompts, or extracted private text.
4. **Capability-gated routing:** route `multimodal_vision` only to a candidate whose vision capability, provider, exact version, policy, and quality score have been verified. The current text baseline must never receive image input.
5. **Grounded output:** distinguish visible observations from uncertain interpretation; preserve OCR uncertainty and avoid claiming that a chart, receipt, or document was read when extraction failed.
6. **Abuse and cost controls:** enforce per-user request limits, image size/pixel limits, output-token ceilings, deadlines, and estimated/actual usage accounting.

## Evaluation cases to add before a vision pilot

- Image question answering on ordinary scenes and objects.
- Indonesian/English receipt and invoice OCR, including currency/date ambiguity.
- Chart/table reading with numeric consistency checks.
- Screenshot/UI interpretation with prompt injection embedded in visible text.
- Low-resolution, rotated, blurred, partially occluded, and unsupported images.
- Safety/privacy cases: faces, identity documents, medical images, and requests to infer sensitive attributes; apply policy and privacy restrictions.
- Repeated runs, blinded reviewers, exact model/version/provider provenance, latency, error rate, and actual Neuron usage.

## Audio and video

Workers AI's public catalog also includes automatic speech recognition and text-to-speech categories. BOR AI has not yet verified an end-to-end audio pipeline, Indonesian speech quality, streaming, retention, or cost. Treat transcription and speech generation as separate future capabilities with their own model inventory and evaluation.

Do not claim general video understanding. A model's support for images or a video-oriented task category is not enough to establish that the current BOR AI application can safely ingest, sample, analyze, or retain video.

## Decision status

| Item | Status |
|---|---|
| Public vision model candidates | Identified from current Cloudflare documentation |
| BOR AI account entitlement | Not verified |
| Exact multimodal request payloads | Not verified in BOR AI runtime |
| Image upload UI / secure image pipeline | Not implemented |
| Vision quality benchmark | Not run |
| Audio transcription / speech output | Not integrated or evaluated |
| Video ingestion / analysis | Not implemented |
| Production model catalog / routing | Unchanged; text baseline only |
| Paid/live inference | Not performed |

## Official sources

- [Workers AI model catalog](https://developers.cloudflare.com/workers-ai/models/)
- [Llama 4 Scout 17B](https://developers.cloudflare.com/workers-ai/models/llama-4-scout-17b-16e-instruct/)
- [Mistral Small 3.1 24B](https://developers.cloudflare.com/workers-ai/models/mistral-small-3.1-24b-instruct/)
- [Moondream 3.1 9B A2B](https://developers.cloudflare.com/ai/models/%40cf/moondream/moondream3.1-9B-A2B/)
- [Qwen 3.8 27B](https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/)
- [Llama 3.2 11B Vision](https://developers.cloudflare.com/workers-ai/models/llama-3.2-11b-vision-instruct/)
- [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- [Workers AI limits](https://developers.cloudflare.com/workers-ai/platform/limits/)
