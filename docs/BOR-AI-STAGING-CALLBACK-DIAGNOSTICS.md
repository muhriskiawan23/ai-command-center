# BOR AI staging callback diagnostics without Cloudflare browser login

## Scope and privacy

This is ONLY the dedicated `bor-ai-billing-staging` Worker with dedicated D1 database
`437ad1fb-2715-40f6-a6a8-71808c2e916a`. It is not the production chat
Worker or its D1 and never changes real user entitlements.

`staging/billing/migrations/0006_callback_diagnostic_buckets.sql` adds
5-minute aggregate buckets containing only: the bucket start time, the
server-selected static disposition (`accepted`, `retry`, `rejected`),
static category, hit count, and last seen timestamp. The table contains no
callback payload, field names, signed fields, order or merchant reference, IP,
customer ID, signature, email, provider HTTP body, or API key. Seven-day
retention is enforced on later inserts; long-idle buckets may remain until the
next new-bucket insert. The callback's validity and financial effect are still
determined by the existing HMAC, immutable IDR amount/order/reference checks,
authoritative Duitku V2 `transactionStatus`, and ledger replay protection.
Telemetry write failure is logged as a static warning and never changes the
payment acceptance/rejection decision.

**Do not interpret a `rejected` record as evidence it came from Duitku**:
anyone can send a malformed request to this public endpoint. Only a signed
callback with verified provider status can count as `accepted`.

## Operator installation (staging only)

The original operator's computer must already be logged in to Cloudflare
Wrangler, and the previous staging Worker and generated config must exist.
Use the pinned GitHub merge commit of this change, not an arbitrary branch.

1. Download `scripts/upgrade-billing-staging-callback-diagnostics.ps1` from
   the pinned GitHub commit and run it with `-Commit <that SHA>
   -ConfirmSandboxOnly`. The script validates the exact Worker name,
   staging D1 UUID, public origin and staging safety flags; downloads both
   Worker and gateway code and migration 0006; runs JS syntax checks; executes
   **remote staging D1 migrations**; deploys **only the staging Worker**; and
   checks `/health`. No invoice, payment or production database is touched.
2. Generate a new strong random report-only token (at least 32 characters).
   Store it as Cloudflare staging Worker secret `BILLING_STAGING_REPORT_TOKEN`
   via Wrangler `secret put` with the **generated staging config**.
   Store the same token in GitHub Actions repository secret
   `BOR_BILLING_STAGING_REPORT_TOKEN`. Do not use the staging *operator*
   token in GitHub Actions. Never commit or paste either value in chat,
   shell history or CI output. Token creation must be performed by the owner.
3. From GitHub Actions manually run **BOR AI isolated billing callback report
   (READ ONLY)**. It calls only
   `GET https://bor-ai-billing-staging.muhriskiawan23.workers.dev/api/billing-sandbox/report/callback-diagnostics?hours=24`.
   The workflow validates staging safety flags and writes aggregate counts to
   its GitHub Actions step summary, which is readable through the linked GitHub
   connector. No Cloudflare API token is needed, and the workflow does not
   deploy code or modify balances.

The separate report token is only authorized for
`GET /api/billing-sandbox/report/callback-diagnostics`. It cannot create
sessions, invoices, change orders, call reconcile, or grant credits. Without
this dedicated secret, the report endpoint returns 503, but other staging
billing functionality remains unaffected.

## Acceptance gate

Resend the **existing already-paid** Basic Sandbox callback at most once if
a new real delivery is needed; do not create or pay another invoice. On success,
the Duitku dashboard should show a successful HTTP callback response. An
`accepted / paid_duplicate` aggregate at the expected time is supporting
server evidence (not identity evidence for the requester). Independently
re-audit the known Basic staging order using the existing
`GET /api/billing-sandbox/operator/audit?orderId=...` and privileged local
operator token; it must remain `paid`, ledgerEntries=1, ledgerCredits=3000,
walletReconciled=true and realCreditsGranted=false.

The report cannot infer provider delivery when no callback request arrived.
It does not automatically resend callbacks. It does not unlock production
billing; pricing, FX, processor approval, refunds, chargebacks, and other launch
gates remain separately blocked.
