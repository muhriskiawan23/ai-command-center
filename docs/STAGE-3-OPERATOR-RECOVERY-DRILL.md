# BOR AI Stage 3 — operator hold recovery drill

Status: **INACTIVE DRAFT / SYNTHETIC ONLY**. Updated 17 November 2026.
Companion to Draft PR #255, Stage 3 hold triage, and issue #253.
**No production migration, payment, AI provider call, remote D1 write or live balance adjustment is authorized by this document.**

## Local-only test

Run with Node 22+:

    node --test tests/stage3-operator-hold-recovery-drill.test.js

The drill uses disposable in-memory SQLite and the unchanged, unapplied migrations
0012 (credit wallet), 0013 (provider plus global spend budgets), and 0014
(append-only provider attempt journal). It exercises actual reservation,
budget-settlement, credit-finalization and aggregate audit adapters, using
fictional accounts and prices. There are **no Cloudflare/Midtrans/Tavily calls
or credentials**. The test-only "two reviewers" simulation is an assertion on
synthetic fixture data, **not real authentication, invoice verification or approval**.

The test demonstrates proposed order and idempotency properties of existing
primitives; it is **not** a deployable operator recovery tool. The current
wallet and provider adapters do NOT independently require provider invoice
evidence or two separate operator approvals. **Never call them directly
for an actual recovery** until a reviewed, access-controlled, atomic,
independently approved operator service exists.

## Human-only incident runbook (no automated repairs)

1. **Freeze the affected request**: prevent paid retries for that request,
   preserve wallet/provider reservations and the entire append-only per-attempt
   journal. Never erase or edit reserved states or ledger rows.
2. **Verify scope and identity** in a restricted operator environment: exact
   authenticated account, original request, all attempt IDs, provider, model,
   tariff version, spend ceiling, budget day and both provider and global caps.
   Do not put identities, prompts or balances in public CI logs.
3. **Collect independently authoritative evidence**: provider usage/invoice
   records for **every dispatched attempt**, including timeouts and retries.
   Verify token counters, tariff, source authenticity, invoice totals, and
   whether the upstream request definitely did NOT run. A missing journal
   event alone is never sufficient evidence for zero cost.
4. **Run read-only audits**: aggregate Stage 3 hold triage and cross-ledger
   reconciliation; investigate all stale attempts, mismatches and orphans.
   Internal SQL consistency cannot validate Cloudflare invoices.
5. **Require independent signoffs** from finance and security/operations,
   plus the founder's explicit approval of the particular action and amount.
   Verify ownership and current statuses again immediately before any action.
   Missing evidence, disagreement, concurrency change, or unknown outcome:
   **keep the reservations held**.
6. **Use only a separately reviewed operator service** with least-privilege
   identity, request-scoped idempotency, atomic guarded transitions, durable
   approval reference and concurrency protections. Such a service is
   **not implemented**. Do not use raw production SQL to bypass triggers.
7. **Re-audit after any approved future action**: one reservation, exact
   provider/global counters, all attempts covered, exact customer debit and
   at most one refund, unchanged other-account balances and replay rejection.
   On conflicting evidence stop rather than retry under a fresh request ID.

## Decision matrix

| Evidence and state | Proposed reviewed action | Forbidden shortcut |
| --- | --- | --- |
| Provider budget settled at independently verified cost; wallet still reserved; all attempts reconciled | Finalize original wallet reservation at approved credit amount, once | New reserve/debit or blind trust in recorded cost |
| Measured journal; provider and wallet reserved; full provider evidence for every attempt | Settle original provider budget at verified total, then finalize original wallet | Finalize wallet first or omit unknown retry |
| Independently proven never dispatched; both holds reserved | Settle original provider at zero, release original wallet with exactly one refund | Treat absence of journal alone as proof |
| Timeout, missing usage, unknown outcome, unpaired dispatch, unverified retry | Keep held pending authoritative provider evidence | Release or assume zero cost |
| Settled budget mismatch, zero cost after dispatch, orphan, or previously settled wallet with unresolved provider | Escalate to reviewed compensation design | Overwrite immutable history, settle twice or charge again |

The current aggregate reports deliberately hide request IDs and user identity.
An independently authenticated and restricted per-case viewer would be needed
for real operator work; none is added here. Every audit remains marked
providerInvoiceVerified=false.

## Verified by synthetic drill (if CI passes)

- Wallet-finalization failure after provider settlement: exact one-time
  wallet settlement and unused-credit refund, with replay rejected.
- Measured provider budget hold: settle provider before wallet, verify both
  provider/global daily counters, then reject repeat operations.
- Simulated independently certified pre-dispatch/no-provider-invocation case:
  zero provider settlement and one full wallet release, without duplicate refund.
  This simulation does NOT establish a safe real-world zero-cost determination.
- Unknown outcomes, missing usage, stale unpaired retry attempts and
  mismatched/zero-settled provider amounts remain held or escalated.
- Provider invoice evidence remains unverified even if local audits are clean.

## Still blocked

1. Authentic Workers AI provider usage and invoice reconciliation, approved
   customer tariffs, margins, payment channel fees, FX and Midtrans validation.
2. A reviewed evidence-bound operator service, maker-checker/founder controls,
   tamper-evident incident logs and an atomic, race-safe settlement design.
3. Failure injection for crash between settlements, parallel operators,
   cancellation, late usage, multi-provider retry and ambiguous dispatch.
4. Independent finance/security/privacy signoff and a newly approved remote
   disposable D1 proof. Local SQLite cannot replace remote D1 evidence.
5. Separate explicit founder approval for production migration, merge,
   paid activation and any actual settlement.

**KEEP PR #255 DRAFT. DO NOT MERGE, DEPLOY, MIGRATE OR BILL REAL USERS.**
