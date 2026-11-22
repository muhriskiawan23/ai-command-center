# BOR AI — one-time synthetic D1 export and restore drill

Purpose: prove the **actual Cloudflare D1 export URL host** and a basic export/import roundtrip with **only synthetic records**. This is **not** a backup of real chat, proof of zero-loss recovery, or permission for a production export.

## Workflow and authorization

Manual workflow: `.github/workflows/bor-ai-synthetic-d1-recovery.yml`.

- `phase=plan` (default): syntax and synthetic tests only. No Cloudflare API calls.
- `phase=drill`: exact unchanged main SHA, owner confirmation `I_APPROVE_SYNTHETIC_D1_CREATE_EXPORT_RESTORE_CLEANUP`, and temporary D1 usage cost acknowledgment `I_APPROVE_TEMP_SYNTHETIC_D1_CLOUDFLARE_USAGE`. No other workflow starts it.
- Uses the existing GitHub `production` environment `BOR_PRIVATE_D1_EXPORT_TOKEN` for only two newly created D1 databases and `CLOUDFLARE_ACCOUNT_ID` to attest the account. Token values never appear in job output.
- Creates `bor-ai-synth-recovery-<GITHUB_RUN_ID>-src` and `bor-ai-synth-recovery-<GITHUB_RUN_ID>-dst`. Fixed account and production D1 pins enforce fail-closed isolation. No customer data is ever read.
- Inserts four fake ordered events, including deletion tombstone and post-snapshot events. Source export uses Cloudflare D1 polling API, authenticates the signed SQL download host, downloads **at most 1 MiB of synthetic SQL**, then imports only into the newly created destination.
- Validates exact row count, deletion tombstone, and SHA-256 fingerprint against the known synthetic fixture. Logs provider download **hostname only**, never signed URL, SQL, bearer token, or real user content.
- In `finally`, crosschecks exact name and UUID before deleting the two D1 databases. Any cleanup failure causes the Action to fail with the synthetic resource ID for manual Cloudflare cleanup. If partial creation is ambiguous, a run-specific name scan is performed.
- No GitHub artifacts containing SQL. No R2 usage, no Worker changes, no Time Travel restore, no paid OpenAI calls or image API calls.

## Important limits

This is a tiny synthetic test, not the actual full-fidelity `bor-ai-chat` database schema. It cannot prove production backup, full message ownership, account deletion semantics, checkpoint journal replay, or zero-loss RPO. Those remain tracked at #382. A *verified synthetic* signed URL host is evidence about the provider's observed hostname on this sample, **not a guarantee** that a production export uses the same host. Independent review is still required before enabling production backup.

Sources: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/ ; https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/ ; https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/ ; https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/delete/ .
