# Midtrans Sandbox / D1 verification gate (review-only)

This is a **manual verification plan**, not evidence that D1 has been tested.
Do not run against production or the remote `bor-ai-chat` database.
The payment SQL is deliberately under `docs/sql/`, not `migrations/`.

## Local D1 prerequisites
1. Use a **disposable local D1 database**, with an isolated Wrangler configuration and no production bindings.
2. Apply the existing credit account and ledger schema to that disposable database first. Check its column names and uniqueness constraints against `tests/payment-orders-sqlite.test.js`.
3. Apply `docs/sql/payment-orders-review.sql` only to the disposable database.
4. Verify `PRAGMA foreign_key_check` and `PRAGMA integrity_check` before and after the test.
5. Do not use real Midtrans keys, customer identifiers, or real transaction payloads.

## Required concurrency and failure matrix

| Scenario | Expected database invariant |
| --- | --- |
| 20 duplicate verified callbacks for one order | Exactly one ledger payment grant; balance increases exactly once |
| Two distinct valid orders for one user | Both grants counted once; final balance is sum |
| Same Midtrans transaction ID presented for two orders | Unique provider identity prevents second binding and grant |
| Pending/failed/expired/cancelled provider status | No paid state and no credit grant |
| Different transaction IDs from webhook and Status API | No state mutation |
| Merchant/order ID, amount, currency or environment mismatch | No state mutation |
| Ledger insert conflict | Whole transaction rolls back: no balance or state change |
| Credit account overflow | Whole transaction rolls back |
| Callback retry after a failed transaction | May succeed once only after the underlying failure is resolved |
| Provider timeout | No state mutation |
| Concurrent callbacks during a process restart | No duplicate grant |
| Order already fulfilled with same verified transaction | No-op, never re-credit |
| Order already fulfilled with different transaction | Reject |

For each case inspect `payment_orders`, `credit_accounts`, and `credit_ledger` together. Record the order state, ledger count, and before/after balance. Confirm both the invariant and the absence of partially committed changes.

## Security review before connecting an endpoint

- Only a trusted server-side handler may call the two provider adapters.
- Never accept a prebuilt `webhook`, `statusApi`, or `verified_paid_candidate` object from clients.
- Authenticate and authorize order ownership for customer-facing reads.
- Restrict sandbox-only functions and secrets to non-production environments.
- Verify provider signature, merchant identity, transaction identity, exact amount and currency, and independent Status API confirmation.
- Ensure callback retries and D1 error handling do not leak server keys or payload secrets.
- Inspect D1 `batch()` atomicity and statement results on the actual local runtime, not only a synchronous SQLite shim.
- Document refunds, disputes, and reversals separately before enabling them.

## Release blockers

No merge or production activation until local D1 concurrency/failure evidence is captured, endpoint trust boundaries are reviewed, and an independent security review is completed. CI passing with SQLite is not a substitute for this evidence.

## Isolated Snap checkout and webhook

The isolated D1 smoke test exercises the sandbox Worker handler with fixture responses
for Snap and the Status API. Its fixed test order is Rp10,000 for 25 microcredits under
a synthetic account. These values are test fixtures with no customer pricing role.

For a provider-backed test, sign in to the Cloudflare account that will host
the isolated sandbox. From the repository root, create a dedicated database:

```sh
npx --yes wrangler@4 d1 create bor-ai-midtrans-sandbox
cp tools/midtrans-sandbox/wrangler.example.json tools/midtrans-sandbox/wrangler.local.json
```

Replace the example database UUID in `wrangler.local.json` with the new database UUID.
Leave the database and Worker names as `bor-ai-midtrans-sandbox`. Run the
following commands from the repository root using that explicit config:

```sh
sandbox_config=tools/midtrans-sandbox/wrangler.local.json
npx --yes wrangler@4 d1 execute bor-ai-midtrans-sandbox --config "$sandbox_config" --remote --file tools/midtrans-sandbox/credit-fixture.sql
npx --yes wrangler@4 d1 execute bor-ai-midtrans-sandbox --config "$sandbox_config" --remote --file docs/sql/payment-orders-review.sql
npx --yes wrangler@4 deploy --config "$sandbox_config"
npx --yes wrangler@4 secret put MIDTRANS_SANDBOX_SERVER_KEY --config "$sandbox_config"
npx --yes wrangler@4 secret put MIDTRANS_SANDBOX_MERCHANT_ID --config "$sandbox_config"
npx --yes wrangler@4 secret put SANDBOX_OPERATOR_TOKEN --config "$sandbox_config"
```

Use the Sandbox Server Key and Merchant ID from the Midtrans dashboard, and a
random operator token of at least 32 characters. Enter secret values only at
the CLI prompts or in Cloudflare's secret settings. Register the deployed
Worker URL with `/webhook` appended as the Payment Notification URL in the
Midtrans Sandbox environment.

1. Send `POST /checkout` with the operator bearer token and a fresh UUID v4 in
   `Idempotency-Key`. Expect HTTP 201 and a Snap sandbox redirect URL.
2. Open the redirect and complete payment using a Midtrans sandbox test method.
3. Confirm the order became `fulfilled`, its sandbox account increased by 25
   microcredits, and the payment ledger has exactly one entry referencing the order.
4. Re-send the notification through the sandbox and confirm the same ledger count
   and balance. Keep the order ID and redacted evidence.
5. If checkout returns 502, reconcile the returned order ID in Midtrans Sandbox
   before creating another order. Retrying the same key returns 409 and avoids
   submitting the same order to Snap again.
