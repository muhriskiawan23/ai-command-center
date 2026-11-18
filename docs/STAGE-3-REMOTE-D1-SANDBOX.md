# BOR AI Stage 3 — disposable D1 journal and billing proof

**Status: proposed, not executed remotely, no paid launch approval.** This runner is isolated from production and makes no paid AI or payment calls.

## Non-negotiable isolation

- The earlier Stage 2 database bor-ai-billing-sbx-stage2-clean-01 has synthetic test data. NEVER reuse or wipe it to run Stage 3.
- For remote testing, founder must create a **brand-new empty** D1 database named like bor-ai-billing-sbx-stage3-proof-01 in the dedicated Cloudflare sandbox account. Use a separate, narrowly scoped sandbox-only D1 token.
- Runner compares name plus UUID against Cloudflare D1 inventory and refuses production D1 name/UUID from wrangler.jsonc.
- The remote test only accepts a new, empty application schema (Cloudflare internal _cf_KV is the sole exception). Unlike Stage 2, Stage 3 cannot resume a half-migrated or previously populated DB.
- It creates a temporary Wrangler config, never loads the production config for D1 execution, never creates/deletes a remote database, and only deletes local temporary files.
- Owner must authorize a later remote dispatch. Neither this document nor any passing local CI automatically launches the remote test.

## Configuration in GitHub billing-sandbox environment

| Key | Type and requirement |
| --- | --- |
| BOR_AI_D1_SANDBOX_TOKEN | Existing dedicated sandbox secret; never paste into chat or source |
| BOR_AI_D1_SANDBOX_ACCOUNT_ID | Existing sandbox account variable |
| BOR_AI_D1_STAGE3_DB_NAME | NEW stage3-specific database name variable |
| BOR_AI_D1_STAGE3_DB_ID | NEW stage3-specific D1 UUID variable |
| BOR_AI_D1_SANDBOX_DB_NAME | Existing Stage 2 sandbox name (mandatory denylist) |
| BOR_AI_D1_SANDBOX_DB_ID | Existing Stage 2 sandbox UUID (mandatory denylist) |

These Stage 3 DB variables are deliberately different from the Stage 2 DB vars, preventing accidental use of the existing populated Stage 2 database.
Both prior Stage 2 environment values are REQUIRED: missing or malformed values stop the remote preflight. Cloudflare inventory UUID and ID fields must agree if both are present; any ambiguity stops before SQL writes.

## Local rehearsal before any remote approval

From the feature branch checkout, run:

    node tests/billing/stage3-d1-proof.mjs --local

This is run by isolated D1 pull-request CI with no Cloudflare token and is sequential, not remote-concurrency evidence.

## Future restricted remote run — manual only

After independent code review, new empty database creation and founder authorization:

    node tests/billing/stage3-d1-proof.mjs --remote

A proposed GitHub workflow for future review must be manual workflow_dispatch only, use billing-sandbox environment, and pin one immutable reviewed commit. No automatic trigger, production deploy, migrations or payments are authorized.

The test applies the exact SQL migration files 0012_credit_ledger.sql, 0013_provider_spend_budget.sql and 0014_provider_usage_journal.sql only to the verified disposable database. It checks exact full schema matching and zero rows after each import. It exercises a 519 micro-USD measured synthetic debit, event journal ordering and immutability, duplicate replay denials, two held unknown-usage reservations, provider and global spend caps, and wallet concurrency. Remote mode runs eight independent concurrent SQL requests per cap; local mode runs them sequentially.

**Failed or interrupted remote runs may leave synthetic data. Never delete, reset, or reuse that database for a new fresh proof; request a new authorized empty sandbox database.**

## Not proven

- Real Cloudflare Workers AI usage and billing, provider invoices, paid tool costs, or any approved customer tariff.
- Actual JavaScript adapters executing against remote D1: remote mode verifies the same three SQL schema/trigger invariants with Wrangler, while integration of the actual JavaScript adapter functions is proven separately in local SQLite tests.
- Crash/retry recovery across calls, authenticated Worker and multi-agent routes, privacy and security approvals, Midtrans production payment lifecycle, or launch readiness.

Log a run URL, test commit, database UUID/name, concurrency counters, anomalies, independent reviewer and founder signoff before declaring this gate complete. Keep PR #245, #254 and #255 unmerged; production billing remains disabled.
## Regression-tested remote-target identity preflight

The remote SQL proof now invokes a pure fail-closed Stage 3 target guard
before constructing any Wrangler request. It rejects invalid or
non-Stage3 database names/UUIDs, missing limited-scope sandbox credentials,
and any match against a production D1 binding or provided earlier Stage 2
sandbox identifier. Its Cloudflare D1 inventory check requires **exactly
one UUID match, exactly one name match and the same record for both**.
Mismatched, duplicate, missing or misleading inventory records stop the
proof before any SQL migrations or test fixtures are written.

`tests/stage3-remote-target-guard.test.js` exercises these preflight
boundaries with fake credentials and synthetic inventory objects. The
tests are local pure functions; **they do not contact Cloudflare**.

An operator must still independently verify the Cloudflare account scope
and approve a new empty DB. The safety check is not proof of actual
account separation, security approval, provider billing, or production
readiness. A remote run remains blocked without an authorized fresh DB.

## Remote Wrangler environment allowlist

The Stage 3 remote SQL proof no longer forwards every GitHub Actions runner
environment variable to Wrangler. Only PATH, HOME, temporary directory
paths, CI and optional XDG config/cache paths are retained, along with
CLOUDFLARE_SEND_METRICS=false and the dedicated Cloudflare sandbox API
token/account ID explicitly required for D1. npm auth tokens, unrelated
GitHub credentials, NODE_OPTIONS and other secret-bearing variables are
not inherited by the Wrangler child process.

Separate Node unit tests enforce this explicit allowlist. This reduces
the credential blast radius but does not substitute for a least-privilege
Cloudflare API token, pinned dependency integrity or an independent review.

## Locked Wrangler supply chain — Stage 3 only

A new separate manifest and npm lockfile live at
`tests/billing/stage3-wrangler-lock/`. They pin the exact CLI
`wrangler@4.160.0` plus 91 npm registry dependency entries with SHA-512
integrity checks (92 total package entries including the root). The
lockfile was generated in credential-free GitHub Actions CI and its
reported SHA-256 was:

`932af7fd768c50eb08a72e960f62daa9c52c17de4fa7529139bb1cb115538437`

The manual-only dispatcher now **copies both files into the temporary
CLI directory and runs `npm ci --ignore-scripts` before granting any
Cloudflare token**. A separate no-secret CI job reproduced the installation
and confirmed the same digest and Wrangler version. Remote runtime still
checks the exact installed binary path and version before D1 inventory
or SQL. It never resolves npm packages while holding its sandbox token.

The normal BOR AI package dependencies are unchanged; the Wrangler lock
is only for the isolated Stage 3 test. Workflow permissions stay read-only,
GitHub checkout credentials are not persisted, and the D1 token is
scoped only to the remote proof step. Local Wrangler tests still use
their existing separate `npx` installation **without** sandbox secrets.

**Still not approved:** an integrity-locked lockfile proves dependency
content hashes, not that every dependency is free from vulnerabilities
or malicious behavior. Independent package provenance/vulnerability review,
Cloudflare D1 token permission inspection, protected environment approval,
an authorized **new empty** Stage 3 sandbox database, green exact-head CI
and founder go/no-go remain required. No remote SQL or paid model call
was run to generate or check this lockfile.
