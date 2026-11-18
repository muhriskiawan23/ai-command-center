# BOR AI Stage 3 — independent operator evidence review (INACTIVE)

**18 November 2026 · Draft PR #264 · NO-GO for live billing**

This document records a small **offline prerequisite**, not an operator
application or an approval to touch balances. The exported
`inspectStage3OperatorEvidence()` in
`src/stage3-operator-review.js` accepts a bounded immutable evidence
binding and externally verified statements/attestations. It writes no
database records, has no HTTP endpoint, cannot settle a provider hold,
cannot refund or debit customer credits, and never enables or replays AI.
Its positive status is deliberately named
`ready_for_separate_manual_finance_review`, not `approved_to_settle`.

## Trust boundary

- A caller **must** first authenticate and authorize both operators in
  an internal system. A string `principalId`, role label, hash, or
  `verified: true` provided directly by a browser is not authentication.
- The caller supplies independently implemented, **trusted**
  `verifyProviderStatement(proposal)` and
  `verifyReviewer(attestation, proposal)` callbacks. They MUST
  validate the provenance of the provider-issued invoice/usage source
  and independently verify cryptographically bound reviewer
  attestations (or equivalent separately approved mechanism). The
  mock callbacks in the unit tests are **synthetic only**.
- Both attestations MUST bind the exact case, immutable D1 evidence
  SHA-256, provider-statement SHA-256, statement cost (nonnegative
  safe integer in micro-USD), and proposed disposition.
- Two distinct verified identities are required, **one in finance and
  one in security**; no single person can supply both roles. Unknown,
  unsigned, mismatched, out-of-bounds or incomplete evidence fails
  closed to `escalation_required`.
- The returned response contains **no case ID, reviewer identity,
  invoice digest, customer ID, request ID, prompt, media or money
  amounts**. Never persist or expose the original evidence bundle in
  public logs.

The only proposed classifications are `keep_hold`, `escalate` and
`request_separate_finance_review`. Even after both reviewers pass,
`financialActionAuthorized` and `customerDebitAuthorized` remain
**false**, as does `providerInvoiceReconciled`: the returned status is
not provider billing reconciliation or evidence that a backend service
actually verified Cloudflare's invoices.

## Why the gate is deliberately separate from settlement

A journaled provider dispatch can incur cost even when the Worker
terminates or token usage is absent. Holds must survive a restart.
Any eventual monetary remediation requires a separately designed
idempotent compensation procedure with authenticated operators,
immutable audit evidence, independent authorization, exact D1
transaction constraints, tested financial invariants, and founder
release approval. None of that is implemented by this proposal.
Do not expose a mutating endpoint or treat a positive result as a
permission to edit credit accounts, releases, budget caps or ledger
history.

## Tests and next hosted evidence

`tests/stage3-operator-review.test.js` exercises synthetic positive
and negative invoice checks, two-role separation, mismatched
attestations, exception handling, malformed costs, privacy of output,
and immutable review bindings.

The **next hosted technical proof** is still outstanding:
1. Review and pin the exact PR head, security boundary and
   migrations. The older `bor-ai-stage3-sandbox-dispatch.yml` pin
   is **not** evidence for this head.
2. Obtain explicit authorization for a **new empty disposable
   Cloudflare D1** under an isolated staging account and least-
   privilege test token. Do not reuse the populated Stage 2 database.
3. Test synthetic provider dispatch, interrupted journal/settlement,
   replay suppression and emergency OFF across **separate hosted
   Worker instances** against that same D1. Audit all three ledgers
   before and after restart. No live AI, Midtrans, customer charges
   or production route.
4. Retain reproducible run ID, commit SHA, target database ID,
   operator approval and privacy-safe counts. Any failed invariant
   is NO-GO and must preserve the journal and holds for analysis.
5. Independently verify usage against **real provider invoices**
   in a separately authorized bounded test. Synthetic verification
   does not substitute for invoices.

No hosted remote D1 execution, production migration, merge, payment,
or live AI invocation is authorized by this document.
