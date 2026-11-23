# BOR AI billing shadow — isolated production dispatch authorization

**Current rollout status:** OFF by default. This change adds a fail-closed **authorization gate** to the manual production deployment workflow. It does not create a D1 database, migrate data, deploy a Worker, generate a secret, change real customer credits or activate checkout.

## Why this guard exists

The existing production workflow accepts an optional `enable_billing_shadow` toggle. When intentionally selected, it prepares a distinct D1 binding, checks the D1 UUID/name and Worker secret, and **executes the noncommercial shadow status schema against that separate remote D1** before candidate deployment. A toggle alone is easy to select accidentally and could initiate a schema write.

Before any Cloudflare queries, D1 schema initialization or Worker deployment, the workflow now runs `scripts/review-billing-shadow-dispatch.mjs` and rejects shadow rollout unless all conditions below hold:

- `enable_billing_shadow` is explicitly selected, and a separate manual text input `billing_shadow_confirmation` exactly equals `CONFIRM_BOR_AI_SHADOW_READONLY_RELEASE`.
- The supplied D1 UUID is syntactically valid, nonzero, distinct from the checked-in production chat and Duitku proof D1 UUIDs. Later Cloudflare metadata checks must still prove that its **actual** name is `bor-ai-billing-shadow`.
- The checked-in production Worker config still has exactly one chat D1 binding and no enabled shadow flag/binding. This prevents the source-controlled default from silently becoming on.
- The same dispatch must **not** simultaneously apply production D1 migrations, run billable Tavily smoke checks, preserve/shut down the URL Reader, activate paid images or switch to the paid Luna-primary configuration.

Ordinary dispatches with `enable_billing_shadow=false` remain unchanged, with no text confirmation required. The confirmation is an **intent check**, not a substitute for separate security/operator approval.

## Newly required four-D1 metadata verification (read-only)

Before even preparing the shadow rollout config, the production workflow now
invokes the existing `scripts/audit-cloudflare-d1-metadata-readonly.mjs`
with the **dedicated read-only Cloudflare D1 token**, the actual
`BOR_BILLING_STAGING_D1_ID` stored as a GitHub secret, and the dispatch's
`billing_shadow_d1_id` input. The job-level shadow ID is reused unchanged.
This script performs four Cloudflare metadata **GET** requests and requires
unique, correctly named D1 UUIDs for `bor-ai-chat`,
`bor-ai-duitku-sandbox`, `bor-ai-billing-staging`, and
`bor-ai-billing-shadow`. Missing credentials, overlapping UUIDs,
unexpected names or network/API failures block the release before the
shadow schema is applied.

The secret `BOR_CLOUDFLARE_D1_READ_TOKEN` must have metadata read access,
and `BOR_BILLING_STAGING_D1_ID` must be the real Cloudflare UUID, not the
all-zero staging template placeholder. Never substitute a write-capable D1
migration token. Tests use fixture UUIDs only. **No one has verified the
actual live four-D1 metadata by merely merging this change**; the run must
be completed and examined before any separate controlled rollout.

This GET-only check does not inspect table rows or prove the schema,
session cookie scope, runtime bindings, secret strength or billing readiness.

## Safety limits and remaining gates

This guard is offline and does not attest real D1 schema, account ownership, secret strength, rate limits, cookie scope, HMAC pepper rotation or remote Cloudflare permissions. The workflow's existing metadata checks, read-only account handling and candidate smoke checks remain required. Running the production workflow with the shadow toggle intentionally ON **can write the shadow-only schema** and roll out a noncommercial read-only status endpoint. Do not dispatch it until an owner has independently reviewed those effects.

A verified deployment would still **not** authorize commercial payments, subscriptions, live credit grants, balance reads, provider callbacks, or real AI usage metering. Keep these disabled pending P0 financial, security, and refund/reconciliation gates.

## Local regression test

```bash
node --test tests/billing-shadow-dispatch-consent.test.js
```

CI must pass before merging the code change. No payment provider or Cloudflare credentials are needed to test the gate.
