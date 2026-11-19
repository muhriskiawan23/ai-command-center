# BOR AI isolated customer billing staging

Status: NOT DEPLOYED. No production payments or production-credit grants.

This staging Worker is separate from bor-ai-chat (production D1) and
bor-ai-duitku-sandbox (earlier fixed Rp10,000 proof database).
Staging amounts are operator-defined test assumptions and ledger credits
are not usable for real BOR AI chat or AI/image API calls.

## Built components

- src/billing-staging-worker.js: separate HTTP entrypoint, strictly disabled
  until explicit flags and dedicated staging secrets are configured.
- staging/billing/migrations/0001..0005: staging-only users, SHA256 session
  hashes, immutable USD/IDR quote, order, payment event, append-only ledger,
  single-use invoice URL, 30-second status-check throttle, and daily quotas.
- wrangler.billing-staging.jsonc: disabled config template with all-zero
  D1 sentinel ID. It is NEVER a working remote production D1 config.
- scripts/prepare-billing-staging-config.mjs: validates independent D1 UUID
  and dedicated HTTPS origin; creates gitignored generated staging config.
- tests/billing-staging-worker.test.js: in-memory SQLite/mock gateway tests,
  no actual Duitku API requests.

## Authentication and security

The operator creates a synthetic staging account using an independent bearer
token. This is not a production Google login or customer entitlement.
The session is an HttpOnly, Secure, SameSite=Strict __Host- cookie.
GET /api/billing-sandbox/me supplies the session-bound CSRF value.
Customer checkout POST requires cookie, exact Origin and CSRF header.
Only the server chooses USD plan price, FX rate, fees and credit amount.
Users can only select Basic or Pro plus their unique requestId.
That requestId is hashed together with the verified staging user ID.
An identical retry gets the same order, quote, reference and payment URL.

Public callback requires verified HMAC-SHA256, an already-bound exact invoice,
matching IDR amount/reference, and authoritative Duitku V2 transactionStatus
00 before one synthetic staging credit grant.
Browser return is not payment proof; incorrect or pending status never grants.
No public refund, reverse-funds or forced-settle route exists.
Operator can perform authenticated read-only audit and a bounded
provider-status reconciliation in case a callback is lost.

Limits: 3 invoices/account/24h, 20 invoices/global/24h, 10 operator-created
sessions/24h, 30 seconds between status checks for the same pending order.
These are test credits only, not real money or usage entitlements.

## Operator-only provisioning steps (Windows PowerShell)

Do NOT do these against production. Nothing here creates or migrates remote
Cloudflare resources automatically.

1. Log into Cloudflare via Wrangler.
2. Create a NEW D1: npx.cmd --yes wrangler@4 d1 create bor-ai-billing-staging
3. Copy its new D1 UUID; do NOT reuse the existing bor-ai-chat or fixed
   Duitku proof database. Establish a rollback/Time Travel bookmark.
4. Set the local process environment to the dedicated new UUID and origin:
   - $env:BILLING_STAGING_D1_ID = 'NEW-STAGING-D1-UUID'
   - $env:BILLING_STAGING_PUBLIC_ORIGIN = 'https://bor-ai-billing-staging.YOURSUBDOMAIN.workers.dev'
5. Run: node scripts/prepare-billing-staging-config.mjs
6. Apply ONLY the staging migrations:
   npx.cmd --yes wrangler@4 d1 migrations apply bor-ai-billing-staging --remote --config wrangler.billing-staging.generated.jsonc
7. Deploy the DISABLED staging Worker:
   npx.cmd --yes wrangler@4 deploy --config wrangler.billing-staging.generated.jsonc
8. Use Wrangler secret put with the SAME staging config to set these
   staging-only secrets, through hidden input prompts:
   DUITKU_SANDBOX_API_KEY,
   BILLING_STAGING_OPERATOR_TOKEN (fresh 32+ char independent token),
   BILLING_STAGING_CSRF_SECRET (fresh independent 32+ char secret).
   Do not paste any keys or tokens into chat, files or git history.
   Wrangler may deploy intermediate versions while secrets are stored;
   staging checkout remains OFF at this stage.
9. Only after reviewing fake FX/fee/credit assumptions, intentionally set:
   $env:BILLING_STAGING_ACTIVATION_ACK = 'SANDBOX_ONLY_NO_REAL_MONEY'
   Run the config generation script again and deploy ONLY staging.
10. GET /health must show configured:true and
    productionCheckoutEnabled:false. Create a test session using the
    operator bearer token, get the test CSRF from /me, create a Basic/Pro
    invoice, simulate payment in the Duitku Sandbox and audit D1.
    Never transfer real money into a test virtual account.
11. Clear the activation acknowledgment, regenerate config and redeploy to
    disable staging invoices once testing is complete.

## No-go conditions for production

No live FX-rate source or approved merchant fees. Plan credits and top-up
tariffs remain tentative. No verified real refund/chargeback settlement flow,
production Google-authenticated customer integration, security/privacy review,
customer funds, or explicit go-live authorization. DO NOT enable production
D1 migrations or route traffic from the production Worker to this staging
billing database.

Official references:
https://docs.duitku.com/api/id/
https://developers.cloudflare.com/workers/wrangler/configuration/

## Safe Windows PowerShell operator check

A helper is available at scripts/verify-billing-staging.ps1.
It is read-only by default:

powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\verify-billing-staging.ps1 -BaseUrl https://bor-ai-billing-staging.YOURSUBDOMAIN.workers.dev

To create an actual Sandbox invoice, deliberately append the
-CreateSandboxInvoice switch. It requests the staging operator token through
a hidden prompt, creates one synthetic test account, and requires a CSRF
token before invoicing. No real customer balance changes. To view an already
created invoice's ledger without payment, run with
-AuditOrderId BSTAGE-<sha256first40>; no new invoice is created.
Do not include actual credentials in any pasted PowerShell output.
