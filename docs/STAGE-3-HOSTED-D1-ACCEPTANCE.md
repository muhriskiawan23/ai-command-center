# BOR AI Stage 3 — Cloudflare staging acceptance plan (NOT EXECUTED)

**Date:** 18 November 2026 | **Scope:** Draft PR #264 and Stage 3 issue #253.
**Release:** NO-GO. This is a gated execution checklist, not evidence of a remote run.

## What is actually proven

- Local SQLite file close/open and local Miniflare/workerd shutdown/recreate
  preserve budget and wallet holds, immutable events, idempotency and emergency
  OFF. These tests use synthetic provider responses and fictional payments.
- Earlier Cloudflare *remote disposable D1 SQL* proofs used an older reviewed
  pin; they are NOT exact-head proof for PR #264.
- The existing `tests/billing/stage3-remote-target-guard.mjs` and
  `tests/billing/stage3-d1-proof.mjs` enforce a fresh Stage 3-prefixed
  database, UUID+name matching Cloudflare D1 inventory, disjointness from
  production and Stage 2 sandbox, exact schema checks and no cleanup.
- The existing manual dispatcher is pinned to the older SHA
  `7a2c34bba59d81f372ec6ed8ee062538324c9665`. Do **not** claim that
  dispatch validates the new reviewer/statement/recovery modules.
- This chat's GitHub connector can update Draft code and inspect Actions
  but cannot create Cloudflare D1, access its account secrets or start
  a new remote workflow dispatch. No remote test is claimed here.

## Preconditions for a separately approved hosted test

1. A Cloudflare account operator provisions **a brand-new, empty,
   disposable staging-only D1** with an exact `bor-ai-billing-sbx-stage3-`
   prefixed name and records UUID/account ID through restricted GitHub
   environment variables. Never supply tokens in chat/PR comments.
2. The operator verifies a read/write token scoped to that **single
   disposable D1**, with no production database, live Worker or payment
   permissions. The protected GitHub `billing-sandbox` environment
   must require independent manual approval, branch restrictions and
   non-production service identity.
3. Review one immutable commit **after** tests and independent security
   signoff; explicitly update a trusted **main-branch manual-only
   dispatcher** to check out that exact SHA. Never use a mutable branch
   label or checkout credentials during the secret-bearing step. The
   existing dispatcher is deliberately not changed automatically.
4. Check source migrations against exact schema snapshots *before*
   mutation; reject non-empty/partial/reused databases. Never reset,
   delete, migrate, or repurpose production/Stage 2 D1.
5. No real `AI` binding, payment gateway, Tavily key, paid Media API
   or public routes may be included. Outbound calls and actual
   charges must remain disabled in synthetic proof workers.

## Required exact-head staging experiments

- **Operator anti-replay:** apply and inspect draft migration 0019 **only** in an explicitly authorized isolated review schema; confirm two trusted synthetic signatures admit one transactional two-nonce record, replay refuses duplicates and history remains append-only. This is a separate operator test, never a customer funds migration.
- **Remote SQL:** D1 credit, budget and usage event schemas, atomic
  concurrency admission, duplicate refusal and append-only audit.
- **Hosted Worker A → B:** send one synthetic request with unknown
  upstream cost; record dispatched + unknown marker, wallet/provider
  holds and hashed logical request claim. Recreate a *different*
  staging Worker instance with the same D1 and confirm a replay is
  rejected before any fake provider call. Do not promote an unknown
  result to settled usage.
- **Two Worker instances concurrently:** same authenticated account
  and request key must admit at most one budget/wallet pair. Check
  daily provider+global budgets, synthetic credits and request IDs.
- **Shared emergency OFF:** turn OFF under a documented controlled
  staging procedure; confirm both Worker instances refuse new
  reservations and retain historic holds, including after restart.
  No real billable provider call is allowed.
- **Interrupted state matrix:** orphan budget, dual hold before
  dispatch, dispatched/no outcome, timeout, measured but provider
  unsettled, provider settled/wallet pending, and wallet settled
  before provider. Run all read-only audits; no auto-refund, debit,
  retry, result delivery or balance adjustment.
- **Evidence:** pin SHA, Cloudflare account alias/DB UUID (stored only
  in restricted evidence), Action run URL, all worker versions and
  failed/successful assertions. Operator exports only private
  finance evidence; public summary contains counts but no customer
  IDs, prompts, session credentials or raw invoices.

## Reject / stop immediately

Any missing Cloudflare identity, reused D1, unexpected schema/data,
credential scope that includes production, nonzero paid-provider call,
audit mismatch, unauthorized dispatch, unreviewed code pin, absent
second reviewer, or stale/unknown cost being silently released makes
the run a **FAIL / NO-GO**. Disable new staging dispatch; preserve
immutable evidence and holds for independent review.

A successful hosted synthetic test would *not* verify actual Workers AI
billing, Cloudflare invoices, Midtrans approval, privacy/URL Reader,
independent finance signoff or production readiness.
