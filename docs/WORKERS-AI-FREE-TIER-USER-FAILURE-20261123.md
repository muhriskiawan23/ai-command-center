# BOR AI - free-tier provider capacity errors

23 Nov 2026. Source-only feature under the owner's $0 *additional* budget.

The deployed Worker may be an older version. Source CI cannot certify the live
service or imply approval to deploy any of these changes.

When the primary Workers AI binding signals documented code 3036 or an exact
known free allocation exhaustion message, the chat route returns HTTP 503,
code ai_daily_allocation_exhausted, and Retry-After until the next UTC day.
For documented provider capacity code 3040 or a generic provider HTTP 429 it
returns HTTP 503, code ai_provider_busy, and Retry-After 30 seconds. The latter
never promises a daily reset. All outputs use fixed English/Indonesian messages
and never include raw upstream messages, tokens or prompts.

Unclassified provider errors remain HTTP 502 and code ai_error. Cancellation
and server timeouts use their existing independent response contracts.
All failed chat attempts refund customer daily units and never claim a failed
turn was saved. Previously saved account history is independent of an AI-only
provider outage (this does not prove D1 disaster recovery).

The regression suite uses a fake AI and local SQLite. No real third-party
inference, Cloudflare deployment, D1 mutation, payment or paid backup is
activated. Issues #156, #382 and #385 remain release blockers.
