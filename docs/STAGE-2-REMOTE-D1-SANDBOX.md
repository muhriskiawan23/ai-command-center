# BOR AI — Stage 2: remote disposable D1 financial verification

Status: **PREPARED, NOT EXECUTED REMOTELY** (15 November 2026).
The local D1 CI proof is real evidence but **not** proof against remote Cloudflare D1. Never label Stage 2 complete until a remote run succeeds and an operator verifies the target identity and audit results.

## Non-negotiable isolation

1. Create a separate **Cloudflare sandbox account** (recommended) and a brand-new empty D1 database. Prefer a limited token from that account rather than any existing production token. This is a genuine remote resource and could incur Cloudflare usage charges; obtain operator authorization before provisioning.
2. Name the database `bor-ai-billing-sbx-<unique-suffix>` (6–40 lowercase alphanumeric/dash characters in the suffix). Record its D1 UUID and account ID privately. Never share API tokens in chat, issues, CI logs or commits.
3. The runner validates that Cloudflare D1 inventory has **exactly the requested name and ID**, that this ID/name does not match the repository production D1 binding, that the DB is empty (allowing Cloudflare's protected `_cf_KV`), or has **only an exact, empty Stage 2 migration schema** left by an interrupted sandbox proof. Any unknown schema, altered definition or nonzero table count blocks further execution, and that no command uses the repository's `wrangler.jsonc`. It creates a new temporary Wrangler config and runs `d1 execute --remote` only against the exact disposable sandbox UUID.
4. The runner does not create a new DB, delete a remote DB, deploy any Worker, call Workers AI, invoke Midtrans/Tavily or touch real customers. A failed run leaves only synthetic data in the designated sandbox DB. Never point it at a shared/staging database with real data.
5. Keep production DNS, D1 bindings, Railway, URL Reader, API payment switches and pricing unchanged.

## Prepared entry points

- `tests/billing/stage2-d1-proof.mjs --local`: exercises the same financial invariants against isolated Wrangler local D1 **sequentially**. Local Wrangler processes sharing one SQLite file do not produce reliable remote concurrency evidence. The existing PR workflow `.github/workflows/bor-ai-isolated-billing-d1.yml` invokes it in CI, without secrets.
- `tests/billing/stage2-d1-proof.mjs --remote`: same scenarios on a dedicated pre-existing **remote** D1. It refuses to execute unless four explicit sandbox variables are provided: `BOR_AI_D1_SANDBOX_DB_NAME`, `BOR_AI_D1_SANDBOX_DB_ID`, `BOR_AI_D1_SANDBOX_ACCOUNT_ID`, `BOR_AI_D1_SANDBOX_TOKEN`. This runner requires the Cloudflare account's D1 inventory to confirm the named database and UUID match.
- `.github/workflows/bor-ai-remote-billing-sandbox.yml`: **manual-only** `workflow_dispatch` GitHub Actions entry point. It uses `billing-sandbox` environment variables/secret, has read-only GitHub permissions and has **no PR/push/schedule trigger**. The workflow is not runnable by dispatch until reviewed and present on GitHub's default branch (or subsequently released through the approved process); no production merge is authorized by this document.

For a manually executed sandbox-only run from a checked-out, reviewed feature branch, the operator can set the four values in their own secure terminal session (not in a checked-in `.env`) and execute:

```bash
node tests/billing/stage2-d1-proof.mjs --remote
```

If the operator uses GitHub Actions after an approved release, configure a dedicated protected `billing-sandbox` environment containing a secret named `BOR_AI_D1_SANDBOX_TOKEN` and variables named `BOR_AI_D1_SANDBOX_ACCOUNT_ID`, `BOR_AI_D1_SANDBOX_DB_ID`, and `BOR_AI_D1_SANDBOX_DB_NAME`. Use required reviewers to prevent an accidental job run. The sandbox credential must not be reused for production.

## Pass criteria (all mandatory)

- Dedicated remote D1 is demonstrably empty before test, using a nonproduction name **and** UUID.
- Both D1 SQL migrations execute on that isolated instance; credit and provider/global budget triggers are installed.
- Duplicate request ID is rejected without a second debit or refund.
- A normal simulated model call reserves maximum exposure and settles measured synthetic cost of 519 micro-units; refund of unused reserved credit is exact.
- Insufficient credit balance is rejected without deduction; a pre-dispatch cancellation returns its full credit exactly once.
- A simulated uncertain provider timeout **retains** both reservations and causes no automatic refund; the audit must flag it for manual reconciliation.
- Eight independent **remote** concurrent global-provider budget reservations at 600 micro-USD each admit exactly four under the configured global cap; reject others without partial budget increments.
- Eight independent **remote** concurrent wallet reservations of 3000 microcredits admit exactly three against a 10000-microcredit wallet; no negative balances or duplicate credit issuance.
- Journal checks prove a 519 net debit on normal settlement and a zero net debit on verified pre-dispatch release.
- **Green local CI is necessary but insufficient.** Cloudflare D1 remote latency, concurrency, transient failures, auth scope and retry behavior must be assessed from the remote run; no real provider costs or payments are tested.

If any of these checks fail, keep Stage 2 **blocked**. Preserve the evidence and do not make assumptions or use a broader token to work around sandbox authorization. The runner prints only a structured summary of synthetic counts and does not print account IDs, API tokens, user IDs or response bodies.

## Required signoff

Record run URL/time, branch SHA, Cloudflare account ownership confirmation (without token), disposable D1 name/ID confirmation, checks and anomaly notes, independent reviewer, and the owner's signoff. Prefer deleting the disposable database after evidence has been reviewed using the Cloudflare dashboard under the sandbox account; the automated harness intentionally never deletes remote resources.

The later production gate remains **NO-GO**: authoritative provider token metering, per-provider billing/invoices, operator-approved pricing and margins, production rollout/rollback plan, alerting and external privacy review are separate work.

## Remote D1 system-table exception

Cloudflare D1 includes the protected internal table `_cf_KV` even on a fresh database. The remote-only freshness check ignores **exactly** `_cf_KV`; it rejects every other non-SQLite table, including prior billing migrations and any application data. This exception never authorizes dropping, deleting, overwriting, or reusing an existing application database. See [Cloudflare's D1 import/export documentation](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## 16 November 2026: remote import output and safe sandbox resume

Remote sandbox run [#43823890101](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43823890101) failed after a successful `wrangler d1 execute --remote --file` migration import because the CLI printed progress text beginning with `├ Checking if file needs uploading` before any JSON. Treating this CLI progress output as pure JSON caused a parser error **after the remote database had already been changed**.

The runner now:
- Checks the exact Cloudflare account/D1 UUID and name as before, with dedicated sandbox-only credentials.
- Inventories the *entire* non-SQLite schema (tables, triggers, indexes, views) and compares normalized SQL definitions against local, known Stage 2 migration snapshots.
- Allows an untouched sandbox, or a sandbox with precisely the first or both Stage 2 migrations applied **and zero data rows** in every corresponding Stage 2 table. It rejects unknown tables, modified definitions and any nonzero app table counts. Local mode still requires a fresh empty database.
- Treats `wrangler --file` as a CLI operation that can print progress; verifies its successful process exit and inspects the **resulting exact schema** rather than parsing progress text as JSON. Regular `--command --json` calls still require valid, successful JSON.
- Never deletes data or recreates a database. A failed or interrupted proof that has already written fixture rows must be investigated and moved to an **authorized new empty disposable database**, not silently reused.

These changes address test-runner behavior only; they do not constitute remote D1 financial invariant evidence until a new successful workflow run completes and is reviewed.
