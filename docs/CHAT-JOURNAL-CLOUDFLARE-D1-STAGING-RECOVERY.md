# BOR AI — Cloudflare staging DO + D1 recovery acceptance gate

23 November 2026. **Prepared as code, NOT deployed or live-tested.** This work
adds an isolated synthetic D1 recovery Worker and an offline contract CI check to PR #435.
The existing `bor-ai-chat-journal-staging` Worker stays D1-free; the production Worker
and its `bor-ai-chat` D1 are unchanged.

A private synthetic Durable Object commits 3 events, including a two-message `turn.saved`.
The disposable D1 receives a checkpoint at 2. Its `batch()` deliberately encounters
a duplicate-primary-key error after both message inserts and before the checkpoint:
both inserts must roll back, checkpoint must remain 2, and the DO receipt must stay at 3.
The same event is then retried (duplicate receipt), two messages and checkpoint 3
are replayed in a successful batch, and message fields and foreign keys are verified.
A second replay is a no-op.

## Limits and required approval

- The D1 schema is intentionally a minimal chat-core approximation; it does NOT
  prove full production migrations, real outages, customer backups or RPO=0.
- GitHub CI runs the same contract against real SQLite semantics with a mock D1
  binding and builds the isolated Worker with Wrangler `--dry-run`. **This
  is offline proof only.**
- For the final staging proof, the owner must separately approve potential usage
  charges for a brand-new `bor-ai-journal-recovery-<runId>` temporary D1, dedicated
  Worker/DO and Workflow. Pin its actual UUID, generate an inert Wrangler config,
  deploy the separate staging Worker with a new private internal secret, trigger
  the one-shot closed Workflow, verify its safe result and clean up each resource.
  Record the Cloudflare Workflow run and deletion receipts before merge.
- `node scripts/prepare-chat-journal-d1-recovery-staging.mjs <runId> <new-db-uuid>`
  generates the config without creating resources. It rejects the known production
  D1 UUID and any production UUID listed in `wrangler.jsonc`.
- Do not merge PR #435 as a **completed Cloudflare D1 recovery** until the live
  staging receipt is green. Do not run a production export or restore.

## Zero-Cloudflare-charge GitHub Actions path (2026-11-23)

The owner opted out of paid browser automation and cannot fund additional
Cloudflare consumption at this time. CI therefore has a **local Workerd**
test in the existing BOR AI tests workflow. It starts \`wrangler dev --local\`
with an in-repository **test-only** Worker, a synthetic SQLite-backed DO and
a local D1 binding, then triggers one recovery run and verifies rollback,
idempotent retry, replay and FK integrity. The second invocation must fail
closed. The Worker is bound to 127.0.0.1, uses no Cloudflare credentials,
and neither creates nor deploys remote resources. CI still consumes ordinary
GitHub Actions minutes, which may be subject to the repository's plan quota.

This is stronger than the pure Node.js mock but **still not a live
Cloudflare-hosted D1 recovery**, nor a real database outage. Keep the PR merge
hold for the complete cloud staging recovery receipt until costs are approved.
