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

**Limits:** A circuit breaker is not an invoice, a real-time cash ceiling, or proof of zero charges. It cannot cancel requests already in flight before the marker becomes visible. The existing lifetime attempt cap and account-level API Platform usage limits also require independent review. The presence of the marker means "billing UNKNOWN" and must not be counted as a confirmed charge. **P0 remaining before paid release:** the D1 image job rows have a user foreign key with `ON DELETE CASCADE`. Account deletion can remove both this marker and records counted by the lifetime cap. This guard is incremental protection only; issue #318 tracks a separate operator-owned, deletion-safe accounting record and independent spend cap.

## Operator recovery procedure

1. **Leave new image generation paused.** Inspect the exact image job identifiers/timestamps and status with account-authorized, minimally scoped D1 reads; do not export prompts, private images, session tokens or secrets in CI/logs.
2. Review the actual OpenAI organization/project usage and charges, invoice/usage latency, model, time window, and accepted API requests. If the billable outcome remains unknown, keep the hold.
3. Review customer credit refunds, planned image credit price, owner-approved pilot budget, and any relevant refunds or compensation. Do not assume successful card/QRIS/bank payment or subscription state from the image wallet alone.
4. Only after independent security, billing and owner approval, implement a **separate audited operator-only reconciliation action**. The current code intentionally includes no automatic way to clear the marker. Do **not** manually overwrite historical error codes or delete job records to bypass the guard.
5. Before resuming, run synthetic and staged tests, confirm the production account R2 privacy, image Queue, D1 rollback plan, provider secret, actual dollar cap and URL Reader preservation; image API remains OFF until these launch gates are complete.

## Static/CI evidence

Synthetic tests exercise network failures, deterministic 400 rejection, pre-existing queued jobs, stale processing and disabled-but-readable user history. An opt-in generated Worker configuration is checked to use one Queue consumer and preserve the default `BOR_IMAGES_ENABLED=false` in `wrangler.jsonc`. Tests use fake byte output and never contact OpenAI.

See also `docs/IMAGE-READONLY-INFRA-D1-TRIAGE.md`, `docs/IMAGE-R2-READONLY-AUDIT-TOKEN.md`, and issue #318.
