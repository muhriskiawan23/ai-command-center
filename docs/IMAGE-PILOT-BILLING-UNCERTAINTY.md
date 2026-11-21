# BOR AI Image Assistant — pause on uncertain provider billing

**Status:** Code safeguard for a future **disabled-by-default** OpenAI image pilot. This document does **not** authorize image API calls, Worker deployment, migration, customer credit grants, or production billing.

## Why the additional guard

The API can accept a paid image request even when BOR AI later sees only a timeout, truncated JSON, storage error or lost response. Previously all failures were refunded to the customer (as intended), but the next customer request could still cause additional unverified provider costs. A per-day quota or a lifetime request counter alone does not distinguish paid versus unpaid errors.

## Behavior

- A request that fails **before the upstream OpenAI dispatch** uses the existing error/refund path, without declaring a charge.
- An explicit upstream HTTP **400** or **429** rejection keeps its existing error/refund path; no global hold is assumed for those responses.
- An ambiguous outcome **after dispatch** (network failure, timeout, unexpected status, unreadable/invalid upstream data, or downstream persistence failure after a provider response) uses `image_provider_billing_unverified` in D1. User credits are still refunded as already defined in `0012_image_jobs.sql`; this change does not secretly charge users for unsuccessful results.
- Stale `processing` jobs also receive this marker because a prior paid call cannot be ruled out; stale `queued` jobs are refunded normally.
- The pilot blocks **new submissions** and **queued jobs not yet dispatched** with `image_pilot_suspended`. Public `/api/images/config` reports `enabled=false` and `unavailableReason=billing_reconciliation_pending`, so the UI does not advertise a payable feature while paused. Previously completed results remain readable by their authenticated owners. The Queue pilot config uses `max_concurrency=1` and batch size 1, so normal pilot processing is sequential.
- The marker is **not** cleared by 7-day cleanup, expiry, redeploy or restart. The code contains no automatic bypass or auto-retry of the paid request. The lifetime cap remains 1–10 provider attempts (operator configured).

**Limits:** This circuit breaker is not an invoice, a real-time USD cash ceiling, or proof of zero provider charges. It cannot cancel a request already in flight. The presence of the hold means "billing UNKNOWN", not a confirmed charge. The operator must still approve actual API Platform spending limits and review real model pricing, privacy, and usage reconciliation.

**Durable D1 meter proposed in the pending image schema:** `image_pilot_meter` contains only a singleton key, aggregate admitted-job count, one unsettled-provider-call bit, a permanent unresolved-billing hold bit and a timestamp. It contains **no user ID, job ID, prompt, image or payment reference**, and has no cascading foreign key. An atomic trigger increments the admitted-job count whenever a job is inserted, so account deletion cannot reset the lifetime ceiling. Another trigger marks billing uncertainty durably. The Worker persists `unsettled_calls=1` before requesting OpenAI and clears it only after a durably completed output or a definite 400/429 rejection. If the Worker crashes or the account is deleted mid-request, that marker conservatively blocks further paid calls until an audited human review.

**Migration review is still mandatory:** this changes the body of **unapplied** `0012_image_jobs.sql`. Do not run production D1 migrations without re-reviewing the exact SQL, current remote pending list, backup/Time Travel rollback evidence, legal retention, and the owner-approved release. This is not a user-level provider journal or a substitute for provider invoices; issue #318 remains open for actual verified dollars and privacy/retention policy.

## Operator recovery procedure

1. **Leave new image generation paused.** Inspect the exact image job identifiers/timestamps and status with account-authorized, minimally scoped D1 reads; do not export prompts, private images, session tokens or secrets in CI/logs.
2. Review the actual OpenAI organization/project usage and charges, invoice/usage latency, model, time window, and accepted API requests. If the billable outcome remains unknown, keep the hold.
3. Review customer credit refunds, planned image credit price, owner-approved pilot budget, and any relevant refunds or compensation. Do not assume successful card/QRIS/bank payment or subscription state from the image wallet alone.
4. Only after independent security, billing and owner approval, implement a **separate audited operator-only reconciliation action**. The current code intentionally includes no automatic way to clear the marker. Do **not** manually overwrite historical error codes or delete job records to bypass the guard.
5. Before resuming, run synthetic and staged tests, confirm the production account R2 privacy, image Queue, D1 rollback plan, provider secret, actual dollar cap and URL Reader preservation; image API remains OFF until these launch gates are complete.

## Static/CI evidence

Synthetic tests exercise network failures, deterministic 400 rejection, pre-existing queued jobs, stale processing and disabled-but-readable user history. An opt-in generated Worker configuration is checked to use one Queue consumer and preserve the default `BOR_IMAGES_ENABLED=false` in `wrangler.jsonc`. Tests use fake byte output and never contact OpenAI.

See also `docs/IMAGE-READONLY-INFRA-D1-TRIAGE.md`, `docs/IMAGE-R2-READONLY-AUDIT-TOKEN.md`, and issue #318.
