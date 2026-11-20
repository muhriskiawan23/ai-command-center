# BOR AI — Cloudflare D1 metadata identity audit (MANUAL, READ-ONLY)

This is the next verification gate after the offline D1 Wrangler binding preflight. It **never** creates/deletes/updates a database, reads rows, executes SQL, deploys a Worker, supplies entitlements, or transfers money.

## Scope and endpoint

The audit uses only the documented Cloudflare D1 metadata endpoint:

`GET https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/{database_id}?fields=uuid,name`

Official documentation: https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/get/

Cloudflare accepts a D1 Read permission for this metadata request. Use a **dedicated, least-privilege D1 Read token**, not a broad account administrator token or existing payment credentials. It sends exactly four GET requests to verify UUID and name for `bor-ai-chat`, `bor-ai-duitku-sandbox`, `bor-ai-billing-staging`, and the **different** future `bor-ai-billing-shadow`. The checked-in production and sandbox Wrangler files supply the first two IDs; the remaining two IDs must be independently confirmed by an operator and provided through private GitHub Actions secrets.

## Setup (no secrets in repository or chat)

In GitHub repository Actions secrets, an authorized operator may configure:

| Secret | Purpose |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Actual Cloudflare account ID |
| `BOR_CLOUDFLARE_D1_READ_TOKEN` | Dedicated Cloudflare token with D1 Read only |
| `BOR_BILLING_STAGING_D1_ID` | Actual verified staging D1 UUID (never the template's zero placeholder) |
| `BOR_BILLING_SHADOW_D1_ID` | An independently created shadow D1 UUID, **only after a separate provisioning decision** |

When those prerequisites exist, an authorized maintainer can manually run the GitHub Actions workflow **BOR AI D1 identity metadata audit (MANUAL READ ONLY)**. This workflow does not run on PR, push, or cron. If a secret or D1 database is absent, it reports a static fail-closed error and does not claim a pass. **Do not provision a new database just to make the audit pass without a separate reviewed and approved provisioning plan.**

The script emits labels and pass/fail only; no account ID, token, D1 UUID, upstream error messages, or raw JSON response is printed. Offline tests use a mocked HTTP fetcher and synthetic staging/shadow UUIDs.

## What success proves — and what it does not

Passing the audit establishes that Cloudflare, for the supplied account and token, returned the expected names and UUIDs for four distinct D1 database metadata entries. It does **not** prove the Worker has a valid live `BILLING_SHADOW_DB` binding, that the shadow schema attestation row exists, that the backend secret is configured, that Google SSO succeeds on a live host, or that any financial flow is ready.

Do **not** enable `BOR_BILLING_SHADOW_ENABLED`, create/alter production schemas, apply the synthetic ledger migration, release paid credits, or enable live Duitku checkout based only on this read-only metadata check. Separate release and security review is required, plus resolution of P0 issues #317, #318 and #319.

## Offline tests

```bash
node --test tests/cloudflare-d1-metadata-readonly.test.js
```

They assert: exact four expected distinct identifiers; missing secret/ID fail closed; only HTTPS GET metadata calls are sent; upstream errors and mismatched name/UUID reject; no raw identifiers or tokens enter the report.
