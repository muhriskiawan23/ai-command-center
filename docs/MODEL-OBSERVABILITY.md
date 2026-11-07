# BOR AI Operational Model Observability

## Current implementation

Every runAgent() model-agent invocation emits one structured log event named BOR_AI_MODEL_TELEMETRY. The event includes:

- agent ID and semantic task profile;
- provider, adapter, exact model ID and routing-policy version;
- success/error outcome and a bounded failure classification;
- total model-call elapsed time, number of attempts and retry count.

The web chat and Public API response traces also include per-agent elapsed time, retry count and outcome. Telegram uses the same structured logging path.

## Privacy boundary

Telemetry intentionally excludes prompt text, generated responses, conversation history, uploaded-file content, user/account IDs, IP addresses, credentials, and raw provider errors. Do not add these fields to logs. The event is operational metadata, not a conversation transcript.

## Viewing events

Use the Cloudflare Workers logs/observability view for the ai-command-center Worker and filter for BOR_AI_MODEL_TELEMETRY. A local development session can inspect the same structured console event. Availability and retention depend on the Worker observability configuration.

## Known gaps

- Logs are not yet a durable analytics store; no D1 schema or production migration was introduced.
- No percentile aggregation, dashboard, alerting, token-usage reconciliation, or monetary cost calculation is claimed.
- The baseline model catalog still has unknown measured quality, latency, reliability and pricing where no verified evidence exists.
- Durable Cloudflare log retention/analytics may incur cost and requires a separate configuration decision before enabling or changing it.

## Next steps

1. Validate event completeness and absence of sensitive fields in tests.
2. Establish an approved retention and cost policy before enabling durable analytics.
3. Add token usage and cost only when the provider returns documented, validated usage metadata and pricing is verified.
4. Build latency/error-rate percentiles and alert thresholds from sufficient production samples.
