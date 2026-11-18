// INACTIVE Stage 3 operator evidence review prerequisite.
// This is NOT an operator login, provider-invoice verifier, financial approval,
// settlement endpoint, or write authority. Never wire to public API routes.
// Callers must supply independent, trusted verification callbacks; strings in
// an approval record do not authenticate a reviewer or a provider statement.
const HASH = /^[a-f0-9]{64}$/;
const PRINCIPAL = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/;
const CASE = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/;
const DISPOSITIONS = new Set([
  "keep_hold", "escalate", "request_separate_finance_review"
]);
const denied = reason => ({
  scope: "inactive_stage3_operator_evidence_only",
  status: "escalation_required",
  reason,
  independentReviewConfirmed: false,
  financialActionAuthorized: false,
  customerDebitAuthorized: false,
  providerInvoiceReconciled: false
});
const safeVerify = async (callback, ...args) => {
  try { return await callback(...args); } catch { return null; }
};
function sameBinding(receipt, proposal) {
  return receipt?.caseId === proposal.caseId &&
    receipt?.evidenceSha256 === proposal.evidenceSha256 &&
    receipt?.providerStatementSha256 === proposal.providerStatementSha256 &&
    receipt?.actualCostMicroUsd === proposal.actualCostMicroUsd &&
    receipt?.disposition === proposal.disposition;
}

// Authn, cryptographic signatures, case-to-tenant ownership and verification of
// the actual provider-issued billing statement MUST happen outside this helper
// in a separately reviewed, private service. Each callback must verify the
// entire immutable proposal binding, not just an actor ID or arbitrary digest.
//
// Even after a matching provider statement and two independent role-restricted
// attestations, the result ONLY establishes readiness for a separate human
// finance process. It never authorizes a debit/refund, releases holds, writes
// to D1, or permits re-dispatch of an ambiguous provider attempt.
export async function inspectStage3OperatorEvidence({
  caseId, evidenceSha256, providerStatementSha256, actualCostMicroUsd,
  disposition, approvals, verifyProviderStatement, verifyReviewer
} = {}) {
  if (!CASE.test(caseId || "") || !HASH.test(evidenceSha256 || "") ||
      !HASH.test(providerStatementSha256 || "") ||
      !Number.isSafeInteger(actualCostMicroUsd) || actualCostMicroUsd < 0 ||
      !DISPOSITIONS.has(disposition) ||
      typeof verifyProviderStatement !== "function" ||
      typeof verifyReviewer !== "function") {
    throw new TypeError("Bounded evidence, cost, and trusted verification callbacks required");
  }
  if (!Array.isArray(approvals) || approvals.length !== 2 ||
      approvals.some(a => !a || typeof a !== "object" || Array.isArray(a))) {
    return denied("two_independent_attestations_required");
  }
  // Snapshot the binding before any potentially async verification. No mutable
  // caller-supplied object is accepted as the canonical review proposal.
  const proposal = Object.freeze({
    caseId, evidenceSha256, providerStatementSha256,
    actualCostMicroUsd, disposition
  });
  const statement = await safeVerify(verifyProviderStatement, proposal);
  if (statement?.verified !== true || !sameBinding(statement, proposal)) {
    return denied("authoritative_provider_statement_unverified");
  }
  const principals = new Set();
  const roles = new Set();
  for (const approval of approvals) {
    const result = await safeVerify(verifyReviewer, approval, proposal);
    if (result?.verified !== true ||
        !sameBinding(result, proposal) ||
        !PRINCIPAL.test(result.principalId || "") ||
        !["security", "finance"].includes(result.role)) {
      return denied("independent_reviewer_verification_failed");
    }
    principals.add(result.principalId);
    roles.add(result.role);
  }
  if (principals.size !== 2 || !roles.has("finance") || !roles.has("security")) {
    return denied("separation_of_duties_required");
  }
  return {
    scope: "inactive_stage3_operator_evidence_only",
    status: "ready_for_separate_manual_finance_review",
    reason: "independent_evidence_review_passed",
    independentReviewConfirmed: true,
    financialActionAuthorized: false,
    customerDebitAuthorized: false,
    providerInvoiceReconciled: false
  };
}
