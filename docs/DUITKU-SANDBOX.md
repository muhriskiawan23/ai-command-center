# Duitku Sandbox BOR AI

This is an isolated operator-only integration proof for project **DS38217**.
It does not activate real payments, subscriptions, production wallet credits,
or image credits. No production chat files, configuration or migrations change.

## Deployment and credentials

1. Run GitHub Actions **BOR AI Duitku sandbox deploy** from `main`.
   It reuses existing Cloudflare deployment credentials, provisions only
   `bor-ai-duitku-sandbox`, applies only `sandbox/duitku/migrations`, and deploys
   the separate Worker `bor-ai-duitku-sandbox`. The `production` GitHub environment
   provides existing Cloudflare credentials; the target resources are sandbox only.
2. In a local checkout containing these files, install the **Sandbox** API key
   using the concealed interactive Wrangler prompt. Never put the value in code,
   GitHub issues, screenshots, chat, command arguments, or logs:

   ```powershell
   npx --yes wrangler@4 secret put DUITKU_SANDBOX_API_KEY --config wrangler.duitku-sandbox.jsonc
   npx --yes wrangler@4 secret put DUITKU_SANDBOX_OPERATOR_TOKEN --config wrangler.duitku-sandbox.jsonc
   ```

   For the second prompt use a separate random secret of at least 32 characters
   from a password manager, and retain it there for operator requests.
   Do not reuse the Duitku API key as the operator token.
   Wrangler may require the operator to log in on their own computer.
3. `/health` should then show `configured: true`. This checks binding and credential
   presence only; it does **not** prove Duitku accepts the API key.
4. Set the Sandbox project's callback URL to:

   `https://bor-ai-duitku-sandbox.muhriskiawan23.workers.dev/api/duitku/callback`

   Use this URL only after deployment confirms the expected Worker origin.
   GET returns 405 intentionally: Duitku delivers callbacks using POST.

## First transaction proof (PowerShell)

This test uses Permata VA (`BT`), Rp10,000 and 100 **test-only** credits. It is
not a pricing decision for Basic/Pro. Only use Duitku's documented sandbox
payment simulator; never transfer real funds to test payment details.

```powershell
$base = 'https://bor-ai-duitku-sandbox.muhriskiawan23.workers.dev'
$operatorSecret = Read-Host 'Sandbox operator token' -AsSecureString
$operatorToken = [System.Net.NetworkCredential]::new('', $operatorSecret).Password
$headers = @{ Authorization = 'Bearer ' + $operatorToken }
$email = Read-Host 'Email untuk checkout Sandbox'
$customerName = Read-Host 'Nama penguji (maksimal 20 karakter)'
$requestId = [guid]::NewGuid().ToString()
$body = @{ requestId = $requestId; email = $email; customerName = $customerName } | ConvertTo-Json
$order = Invoke-RestMethod -Method Post -Uri "$base/api/sandbox/checkout" -Headers $headers -ContentType 'application/json' -Body $body
$order
Start-Process $order.paymentUrl
```

After simulating payment, inspect local state without calling Duitku repeatedly:

```powershell
Invoke-RestMethod -Uri "$base/api/sandbox/orders/$($order.orderId)" -Headers $headers
```

If the provider callback is delayed, perform **one** explicit reconciliation:

```powershell
Invoke-RestMethod -Method Post -Uri "$base/api/sandbox/orders/$($order.orderId)/reconcile" -Headers $headers
```

On an ambiguous checkout timeout, keep the original request ID. Do not blindly
create another invoice. Recover its state using `BORTEST-$requestId` and the
reconciliation endpoint. Reusing an ID never issues another provider invoice.
Local inspection is read-only; reconciliation is bounded to one provider check
per order per 30 seconds. There is no scheduled provider polling.

## Invariants and verification

- HMAC-SHA256 implements the current Duitku V2 invoice, callback and status
  formulas. MD5 and bare SHA256 signatures are not accepted.
- Callback amount, merchant, order and reference must match. Duitku's
  server-to-server transaction status is verified before settlement because
  callback `resultCode` is not included in the signed string.
- Redirect query strings never authorize settlement.
- Only known orders are reconciled. Duplicate successful callbacks do not
  call Duitku again or grant another test credit.
- A SQL trigger inserts the unique simulation ledger entry in the same
  transaction as payment settlement. Database failures cannot mark an order
  paid without recording its test credit. Paid is terminal.
- Checkout is operator authenticated, fixed-price and capped at 10 invoices
  per rolling 24 hours. Email/name are forwarded to Duitku only for checkout;
  neither is persisted in this D1 schema. Provider payloads and errors are
  not logged or echoed.
- A real Sandbox checkout/callback round trip still requires configured
  credentials and an enabled sandbox payment channel. Tests use synthetic
  provider responses and do not replace that live proof.

Before production: merchant approval, separate production project/credentials,
reviewed USD-to-IDR locked quotes and fees, customer authentication and order
ownership, subscription/top-up settlement, refunds and billing ledger review.

Official API reference (checked 19 November 2026):
https://docs.duitku.com/api/en/
