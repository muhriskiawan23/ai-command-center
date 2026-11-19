# BOR AI billing staging: operator-approved lifecycle simulation

**No live payment activation. No live AI calls. No production customers.**

This implementation adds an opt-in demonstration to the **existing isolated
`bor-ai-billing-staging` Cloudflare Worker and D1**. It does not integrate
the production Google sign-in, chat routing, actual OpenAI/Tavily usage,
production billing D1 or an approved commercial entitlement. The control
flag `BILLING_STAGING_SIMULATION_ENABLED` defaults to **false**.

## Why now

Previous PRs separately proved signed Sandbox callback idempotency (#312),
synthetic use-credit reservations (#322), manual Basic/Pro subscription
terms (#324), and trusted-looking *offline* text usage receipt validation
(#326). Their modules were not connected to an authenticated staging HTTP
flow. The new routes connect them without ever calling a billable model
provider. No new money transaction or Duitku Sandbox invoice is necessary
for this code change.

## Staging route behavior (isolated synthetic sessions only)

Every route below additionally requires
`BILLING_STAGING_SIMULATION_ENABLED='true'` on the **dedicated** staging
Worker. Routes are **404** when disabled. The Worker itself must still pass
its existing strict staging D1 binding/DS Sandbox credentials and origin
checks.

| Route | Method | Who | Behavior |
|---|---|---|---|
| `/api/billing-sandbox/simulation/plan` | GET | `__Host-bor_billing_stage` session cookie | Reads current synthetic term and test-credit wallet, including held/spendable balances; no mutation |
| `/api/billing-sandbox/simulation/activate` | POST `{"orderId":"BSTAGE-..."}` | Same cookie + same-origin CSRF | Issues exactly one manual Basic/Pro term only from an already verified paid owned order with one test-credit grant |
| `/api/billing-sandbox/simulation/cancel` | POST `{"orderId":"BSTAGE-..."}` | Same cookie + same-origin CSRF | Sets `cancel_at_period_end` without initiating any refund or automatic debit |
| `/api/billing-sandbox/simulation/text-usage` | POST `{"requestId":"UUID"}` | Same cookie + same-origin CSRF + active paid term | **Only a fixed server-side fixture** for nonstream OpenAI-style receipt (600 input, 200 output tokens). Reserve 30 maximum test credits; settle 14 test credits using simulated rate; release 16 unused. Replays never double debit or issue a second provider call |

The client may submit only the route's specified IDs. Client-supplied
token counts, model names, USD rates, tool charges and quote prices are
rejected. Account sessions are generated through the already-existing
operator-only `POST /operator/session`; these are **not** the BOR AI
production Google accounts. `/checkout` remains a real Duitku
**Sandbox** invoice route and is unchanged.

An `active` value returned by the simulation **never** enables real
BOR AI AI-model access or a commercial subscription. The fixture
`modelId` is `staging-offline-text-fixture`; its response and rate
are synthetic. There are no OpenAI/Workers AI/Tavily API calls on this
route. The result explicitly labels
`usageSource: fixed_server_test_fixture_not_a_provider_bill` and always
`realCreditsGranted:false`.

## Security and operational gates

- **Separate environment:** no import into `src/index.js`, no production
  Worker config, no prod D1 migrations.
- **Session and CSRF:** every mutation requires synthetic-session cookie,
  same-origin header and per-session CSRF; the customer cannot activate
  another test account's order or spend another account's wallet.
- **Immutable ledger:** D1 migrations `0007` and `0008` must be applied
  to the **dedicated staging D1** before the new flag is enabled. Once
  enabled, reservation/settlement are atomic and idempotent, with a
  conservative max-credits guard.
- **No lifecycle shortcuts:** pending orders cannot create an entitlement;
  cancellation does not automatically refund; period rollover requires a
  new independently paid order. Refund and chargeback only work against
  existing verified synthetic accounting, **not actual cash**.
- **No silent backfill:** a previously paid order remains paid/unchanged
  until the same original synthetic session holder activates its term.
  Expired sessions cannot be recovered by changing a user ID.
- **No release proof:** this stage simulation does not prove true per-user
  production AI billing, provider cost contracts, actual invoice settlement,
  security of real customer credentials, or compliance.

## Test results

`node --test tests/billing-staging-worker.test.js` checks the opt-in
switch, signed first paid callback, test ledger, same-user activate,
cross-user 404, missing CSRF 403, client spoofing 400, usage replay
(14 billed test credits exactly once), cancellation and no new invoice.
The full unit suite and Worker preview build remain CI gates.

## Applying later to the owner's local staging project

After PR merge and successful checks, `scripts/upgrade-billing-staging-lifecycle.ps1`
is a **manual owner-approved** Windows script. It verifies the exact
staging Worker name, D1 database UUID
`437ad1fb-2715-40f6-a6a8-71808c2e916a`, staging URL,
D1 binding and current health flags before fetching files from a
**pinned merged commit** via the owner's authenticated GitHub CLI.
It runs local Node tests, updates only the staging generated Wrangler
config, applies pending isolated staging migrations and deploys only
the billing staging Worker when explicitly invoked with
`-ConfirmSandboxOnly -EnableSimulation`. It never creates an invoice,
makes a payment, issues a real customer credit, accesses a production
secret or deploys the production Worker.

**This PR alone does not deploy the migrations or staging Worker.** The
existing previously paid Basic test invoice should not be repaid or
resent. Existing sessions expire and are not recoverable; a fresh
operator synthetic session will have **zero** test credits unless
explicitly paid in Sandbox under that new session. Do not pay money
to make this optional demonstration pass; the full mocked lifecycle
is already verified in CI.

## P0 blockers before real billing

See [#317](https://github.com/muhriskiawan23/ai-command-center/issues/317),
[#318](https://github.com/muhriskiawan23/ai-command-center/issues/318)
and [#319](https://github.com/muhriskiawan23/ai-command-center/issues/319):
merchant approval, real provider billing receipt/rate version and
metering guard, production user identity bridge, channel rules,
subscription renewal/cancellation, verified money refund,
chargeback evidence, rollover and operational rollback. Billing
production stays **NO-GO**.
