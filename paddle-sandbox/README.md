# Paddle sandbox: isolated validation foundation

This branch does not connect production, change chat authentication, alter billing databases, or grant credit. The Worker is a validation-only receiver. Basic is USD 1.99/month (199 minor units), Pro is USD 6.99/month (699 minor units). Credit allotments remain unfinalized.

## Account-side setup (requires authenticated sandbox account)
1. Open https://sandbox-vendors.paddle.com/ and create or sign into a separate sandbox account.
2. Create two products and recurring monthly USD prices for Basic and Pro; use quantity 1. No live catalog changes.
3. Create a sandbox client-side token (test_ prefix), and configure the sandbox default payment link. Never commit API keys or webhook secrets.
4. Configure an isolated test endpoint and subscribe to transaction.completed, transaction.payment_failed, subscription lifecycle and adjustment events. Store the endpoint secret as PADDLE_SANDBOX_WEBHOOK_SECRET in the sandbox Worker only.
5. Set the test token and the two sandbox price IDs as PADDLE_SANDBOX_CLIENT_TOKEN, PADDLE_SANDBOX_BASIC_PRICE_ID and PADDLE_SANDBOX_PRO_PRICE_ID. Set PADDLE_SANDBOX_ENABLED=true only after checking the sandbox dashboard.
6. Use Paddle.js with Paddle.Environment.set("sandbox") before initialization. A separate test checkout UI is still needed; no link from live BOR AI.
7. Run local tests with node --test tests/paddle-sandbox.test.mjs. Use Paddle webhook simulator to verify the real signed requests. Test successful, failed, renewal, cancellation, refund and duplicate deliveries.

## Remaining safety gates
- Bind purchases to server-verified Google identity through a server-created checkout intent, never browser-supplied customer IDs.
- Verify the actual sandbox product/price, transaction, status, currency and quantity via server-side API; implement atomic event and transaction idempotency in an isolated database, including out-of-order events and reversal handling.
- Validate actual credit economics, paid allocations and top-up/refund rules. Implement entitlements only after approval.
- Do not enable commercial checkout until account verification, end-to-end sandbox evidence and production release gates pass.

References: https://developer.paddle.com/get-started/quickstart/ and https://developer.paddle.com/webhooks/about/signature-verification/
