# BOR AI Operational Observability

**Implementation scope:** structured per-model-call events plus Cloudflare Workers Logs.  
**Data boundary:** operational metadata only; no prompts, completions, conversation history, uploaded file content, credentials, user IDs, or email addresses.

## Event contract

Each model inference attempt emits one JSON event named `borai.model_call`:

| Field | Meaning |
|---|---|
| `schemaVersion` | Event schema version |
| `requestId` | Random correlation ID shared by model calls in one request |
| `agentId`, `taskProfile` | BOR AI specialist and semantic task profile |
| `provider`, `adapter`, `modelId` | Actual selected inference route |
| `policyVersion` | Adaptive routing policy version |
| `attempt` | Attempt number for this specialist, including output-repair retries |
| `latencyMs` | Wall-clock time spent awaiting this inference attempt |
| `outcome` | Inference call success or error |
| `promptTokens`, `completionTokens`, `totalTokens` | Included only when the provider response supplies recognized numeric usage fields |
| `errorType` | Sanitized error class only; raw error message is deliberately excluded |

A successful inference call is not necessarily a successful user request or a high-quality answer. Quality is evaluated separately with the offline benchmark and human review.

## Privacy and security

- Never log message text, prompts, generated text, memory, source-page contents, file contents, user identifiers, API keys, authorization headers or raw provider errors.
- Do not treat token usage as guaranteed: the event omits usage fields when the response does not provide recognized counts.
- Telemetry emission is best-effort. A logging failure must not change the model response or fail the request.
- Request correlation IDs are random and are not authentication tokens.
- Keep Cloudflare invocation metadata separate from custom model events; inspect the dashboard configuration and access controls before sharing logs.

## Cloudflare Workers Logs

The Worker configuration enables observability with a 100% head sampling rate. This makes the initial low-volume baseline easier to measure, but log volume and account usage must be checked after deployment. Cloudflare currently documents Workers Logs retention and included event quotas by Workers plan; pricing is scheduled to change on 2026-12-01. Recheck the official pricing page before scaling or increasing traffic.

- [Workers Logs configuration, limits and pricing](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Wrangler observability configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)

Dashboard path: Workers & Pages → `ai-command-center` → Observability. Filter custom events by `event = borai.model_call`, then group by `modelId`, `taskProfile`, `agentId` and `outcome`. Calculate latency percentiles from `latencyMs`; do not infer request-level success rate from inference-call outcomes alone.

## Current limitations

- Events are retained in Cloudflare Workers Logs, not copied into D1. No schema migration is required.
- This first version records model-call latency and error class, not end-to-end request latency, retrieval latency, queue time, or final-answer quality.
- Cost can be estimated only when token usage is returned and the model's dated price record is known. The event does not claim a cost when either is missing.
- Workers Logs retention is finite; this is operational troubleshooting telemetry, not a permanent analytics warehouse.
- Model quality scores are not inferred from latency, user feedback alone, or model self-assessment.

## Follow-up metrics

After real events are available, build dashboards for:
- calls and failures by model, provider, task profile and agent;
- p50/p95/p99 model-call latency;
- retry frequency and timeout/error classes;
- token usage and estimated cost where both usage and dated price are known;
- cost per successful, human-reviewed evaluation task.

Avoid storing raw user feedback or message content in telemetry. If feedback is later joined to model traces, use a separate privacy review and a minimal, non-identifying linkage design.
