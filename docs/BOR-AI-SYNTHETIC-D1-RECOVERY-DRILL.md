# BOR AI — one-time synthetic D1 export and restore drill

**Verified 23 Nov 2026, 10:36 WIB — SUCCEEDED, both temporary databases DELETED.**
The exact Cloudflare signed URL hostname was observed and four fully synthetic
rows were round-tripped with matching SHA-256. The production `bor-ai-chat`
database was not accessed or modified. **This is NOT a backup of real chat,
proof of zero-loss recovery, or permission for a production export.**

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

## Verified run #45106929742 — evidence and cleanup

- Owner approved exactly one synthetic two-DB create / export / import / verify
  / cleanup run and temporary Cloudflare D1 usage costs. A main-locked,
  exact-diff one-time dispatcher ([PR #423](https://github.com/muhriskiawan23/ai-command-center/pull/423))
  invoked only the existing manual `phase=drill` workflow on approved source
  commit `a70b83593fc3b4ee3e0fa8054875952f69f219ab`.
- Real GitHub Actions
  [run #45106929742](https://github.com/muhriskiawan23/ai-command-center/actions/runs/45106929742)
  **SUCCESS**, including real protected-environment D1 create, read, export,
  signed SQL download, second fresh D1 import, data-integrity check and
  explicit resource cleanup.
- Temporary source: `bor-ai-synth-recovery-45106929742-src`,
  UUID `5854f573-064b-4e65-933f-d8fef66731a5`.
- Temporary restore target: `bor-ai-synth-recovery-45106929742-dst`,
  UUID `d97fb66b-ec19-45e5-9780-fe136a246414`.
- Cloudflare returned a synthetic signed download URL on hostname
  **`1ad59b064bfa3690063414a9906129e4.r2.cloudflarestorage.com`**.
  This matches the preexisting isolated backup Worker host configuration.
  The complete signed URL, bearer tokens and SQL dump were NOT logged.
- Four synthetic events (including deletion tombstone and post-checkpoint
  events) matched source and imported target by SHA-256:
  `f8f5a577100ab40c2127d9a92faa31e6d285f4a846b544e2bb70e132540b2a8f`.
- Logs prove **both** temporary DB UUIDs were deleted using the guarded
  cleanup path. The final receipt returned
  `syntheticResourcesCleanedUp:true`. No unresolved cleanup error reported.
- Corrected the missing `output_format:'polling'` in the synthetic D1
  continuation POST and added a strict mock assertion before the real drill.
  CI for PR #423: 1,039 tests passed, 0 failed, 1 skipped.
- The one-time dispatcher and its dedicated test were deleted in a cleanup
  PR; the original manual synthetic workflow remains available for a
  future *separately approved* run.

### Not proven / cannot be called complete production disaster recovery

This is a tiny fake schema. It does not prove that an actual `bor-ai-chat`
export will finish; that a valid encrypted/private SQL copy was stored; that
full production Google sessions, message ownership, attachments, account
deletion and feedback survive recovery; or that independent journal events
after a checkpoint can be idempotently replayed against the **real** schema.
The Worker is updated but two older actual production D1 exports both failed,
and the third real export remains **hard locked**, requiring separate explicit
owner approval of operational availability impact and safety. Independent
journal deployment and backfill still require separate budget/privacy review
and production release authorization. Issue #382 remains OPEN; RPO=0 is NOT
established. Actual Cloudflare usage costs were not measured by this drill.
