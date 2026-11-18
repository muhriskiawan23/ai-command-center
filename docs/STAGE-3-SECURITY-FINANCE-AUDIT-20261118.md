# BOR AI Stage 3 — provisional security & finance audit

**Date:** 18 November 2026. **Status:** INDEPENDENT ACCEPTANCE OUTSTANDING;
**Decision:** **NO-GO for customer payments and paid AI**.

This is a code/available-evidence review, **not an independent audit
certificate**, production penetration test, legal review, or actual
provider billing audit. Do not cite it as a launch approval.

## Evidence matrix

| Gate | Current evidence | Audit conclusion |
| --- | --- | --- |
| Stage 3 SQLite recovery | Local close/reopen plus failure injections; synthetic | Verified locally only |
| Stage 3 Workerd restart | Same local persistent D1 reused across two runtime recreations | Verified locally only |
| Exact-head unit/browser CI | Check linked Actions for final SHA; cancelled intermediate runs are not passes | Verify latest run |
| Hosted D1 cross-instance | No successful exact-head, newly approved remote run | **OPEN** |
| Operator identity | Ed25519 offline signed review prototype with key allowlist, bounded timestamps, distinct finance/security roles | **PARTIAL**; no SSO/production key enrollment, revocation distribution, persistent nonce replay ledger |
| Provider cost reconciliation | Read-only provider-period comparison; injected source-verification callback; aggregate match never releases holds | **PARTIAL**; no real invoice source/authentication or per-attempt allocation |
| Emergency OFF and idempotency | Local shared-D1 proofs; hosted cross-instance proof missing | **OPEN** |
| Stale/unknown charge handling | Hold preservation; no automatic replay, debit or refund | Local validation; manual recovery service missing |
| Midtrans & USD/IDR FX | Isolated Draft PR #247; live merchant approval and complete settlement lifecycle not evidenced here | **OPEN** |
| Security/privacy outbound egress | Issue #156 remains open; URL Reader stays OFF | **OPEN** |
| Cost/plan/margin approval | Versioned synthetic tariff; real provider/model usage, quotes and independent finance signoff missing | **OPEN** |
| Founder/independent release decision | No founder production merge/migration/activation approval recorded for this stack | **OPEN** |

## New safeguards in this follow-up

- `src/stage3-signed-operator-auth.js` verifies **Ed25519 signatures**
  over a canonical case + D1 evidence SHA-256 + provider statement
  SHA-256 + amount + proposed disposition, with trusted server-side
  role/key assignment, 15-minute maximum validity and revoked-key
  rejection. The caller must independently authenticate/enroll
  operators and maintain a persistent one-time nonce/approval log
  before *any* future executable operation. Current verification is
  **offline/advisory** and not a login system.
- `src/stage3-provider-statement-reconciliation.js` compares an
  explicit UTC/USD provider-period amount to immutable journal totals.
  A source verifier must authenticate the real statement separately.
  It reports unknown, unverified, unmeasured, mismatched and
  out-of-period evidence without exposing request IDs; even a
  matching aggregate report **never** proves per-attempt billing.
- `src/stage3-release-readiness.js` provides a fixed exact-head
  advisory matrix. Unverified/partial/missing checks keep NO-GO.
  Even all manual checkboxes yield only
  `INDEPENDENT_RELEASE_REVIEW_REQUIRED`, never deploy/payment
  permission. It has no production import or monetary write.
- Negative unit tests exercise tampered signatures, role spoofing,
  provider invoice mismatch, incomplete usage, missing evidence,
  malformed input and false-positive release decisions.
- `docs/STAGE-3-HOSTED-D1-ACCEPTANCE.md` specifies protected
  operator authorization and controlled hosted tests with a
  new isolated Cloudflare D1 and actual separate Worker instances.

## Explicit unresolved risks

1. **Cryptographic attestations are not account login**: identity
   provider integration, key enrollment/revocation, server-side
   reviewer authorization, replay-resistant durable nonce storage and
   tamper-evident case audit require independently reviewed
   implementation and a separate internal restricted service.
2. **Invoice provenance is unverified**: no authenticated Cloudflare
   billing exports/statement, real-token measurement, tariff approval,
   billing clock reconciliation or per-attempt authoritative cost
   evidence is available in this environment. Aggregate equality
   must not settle customer credits.
3. **Cloudflare staging access is unavailable here**: the GitHub
   integration is not a Cloudflare staging credential. Fresh D1
   provisioning, protected manual workflow approval, hosted Worker
   deployments and cross-instance experiments require authorized
   Cloudflare operator access; none are claimed executed.
4. **Production launch requires external decisions**: complete
   Midtrans merchant/payment lifecycle, Tavily contract, privacy and
   outbound-egress security review (#156), real model moderation
   and output retention, independent finance/security signoff,
   data migration/rollback and explicit founder go/no-go.

## Operational prohibition

No merge, production deployment, payment processing, live AI call,
migration, deletion, budget toggle or financial adjustment is
authorized by these artifacts. Keep Draft PR #264, all paid flags OFF,
and unresolved holds intact until each gate has independently
verified, **exact-commit and environment-specific** evidence.
