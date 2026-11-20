# BOR AI — Cloudflare D1 shadow candidate binding preflight (OFFLINE ONLY)

This step does **not** create a Cloudflare D1 database, apply a migration, read customer records, reveal a secret, invoke a provider, change deployment configuration or authorize paid billing.

## Why this guard exists

The production Worker `ai-command-center` has a chat D1 named `bor-ai-chat`. The operator-only `bor-ai-billing-staging` D1 and the separate fixed Duitku proof D1 must **never** be used as customer billing storage. The read-only shadow account route has been developed and tested offline; it is still **OFF** in the checked-in production `wrangler.jsonc`.

A future Cloudflare operator may prepare a **local, uncommitted** Wrangler candidate to add `BILLING_SHADOW_DB`. Before it can even be reviewed, check that no database ID is reused or migration directory crossed.

## Offline invocation after the operator has independently obtained actual D1 identifiers

1. Prepare a local copy of `wrangler.jsonc` outside Git tracking, without any secrets. Retain the existing `DB` entry exactly as is. Add a *different* `BILLING_SHADOW_DB` entry with `database_name=bor-ai-billing-shadow`, a newly verified separate D1 UUID, and `migrations_dir=staging/billing-shadow`.
2. Set only `BOR_BILLING_SHADOW_D1_NAME=bor-ai-billing-shadow` and `BOR_BILLING_SHADOW_ENABLED=false` in that candidate's `vars`. **Never put `BOR_BILLING_SHADOW_PEPPER` in `vars` or GitHub.**
3. Supply the **actual** operator-verified `bor-ai-billing-staging` D1 UUID to the process, not the all-zero placeholder in the checked-in staging template. Then run:

```bash
BOR_BILLING_STAGING_D1_ID="<verified-staging-d1-uuid>" \
  node scripts/check-billing-shadow-d1-binding.mjs /path/to/local-uncommitted-wrangler-candidate.jsonc
```

The script reads only local JSON: the committed production, staging-template, proof Wrangler files and the supplied candidate. It never contacts Cloudflare, never prints D1 IDs or credentials, and never writes a file. It **fails closed** if the staging UUID is absent, an ID is invalid/duplicate, expected bindings or migration directories change, the production baseline has shadow enabled, a plaintext pepper appears, or the candidate enables the feature. The candidate must also match the complete production configuration **exactly** aside from the new disabled shadow binding and the two approved shadow metadata vars; changed rate limits, AI bindings, old vars or unrelated resources are rejected.

## CI proof

`node --test tests/billing-shadow-d1-binding-preflight.test.js` executes a valid synthetic candidate and negative fixtures for production/staging/proof D1 collisions, invalid migration paths, all-zero identifiers, missing staging ID, wrong worker configuration, and early enablement. CI runs synthetic UUIDs, not any actual staging identifier.

## What a passing offline result does NOT prove

It does **not** prove the UUID belongs to the desired Cloudflare account or D1 instance, that real Cloudflare bindings are correctly resolved, that schema attestation succeeds, that D1 credentials are least-privilege, or that Google login, callbacks, credits or merchant approval work in production.

Before any use beyond offline tests, separately verify live D1 metadata through *read-only* Cloudflare access; confirm isolated account ownership, backup/rollback capability, rate limit and cookie scope; review HMAC secret handling and migration restrictions; and complete P0 issues #317/#318/#319 and explicit owner approval. No real customer checkout or entitlement should be turned on under this preflight.
