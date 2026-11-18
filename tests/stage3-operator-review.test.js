import test from "node:test";
import assert from "node:assert/strict";
import { inspectStage3OperatorEvidence } from "../src/stage3-operator-review.js";

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const base = {
  caseId: "stage3-synthetic-case-1",
  evidenceSha256: hashA,
  providerStatementSha256: hashB,
  actualCostMicroUsd: 519,
  disposition: "request_separate_finance_review",
  approvals: [
    { principalId: "finance-reviewer", role: "finance" },
    { principalId: "security-reviewer", role: "security" }
  ]
};
const verifiedProvider = async proposal => ({ ...proposal, verified: true });
const verifiedReviewer = async (approval, proposal) => ({
  ...proposal, verified: true, principalId: approval.principalId, role: approval.role
});
const inspect = (overrides = {}) => inspectStage3OperatorEvidence({
  ...base,
  verifyProviderStatement: verifiedProvider,
  verifyReviewer: verifiedReviewer,
  ...overrides
});
function noAuthority(report) {
  assert.equal(report.financialActionAuthorized, false);
  assert.equal(report.customerDebitAuthorized, false);
  assert.equal(report.providerInvoiceReconciled, false);
  assert.ok(!JSON.stringify(report).includes(base.caseId));
  assert.ok(!JSON.stringify(report).includes("finance-reviewer"));
  assert.ok(!JSON.stringify(report).includes("security-reviewer"));
  assert.ok(!JSON.stringify(report).includes(hashA));
  assert.ok(!JSON.stringify(report).includes(hashB));
}

test("two independently authenticated roles can complete review but NEVER authorize money movement", async () => {
  const report = await inspect();
  assert.equal(report.status, "ready_for_separate_manual_finance_review");
  assert.equal(report.independentReviewConfirmed, true);
  noAuthority(report);
});

test("hold and escalation classifications remain non-executable even after reviews", async () => {
  for (const disposition of ["keep_hold", "escalate"]) {
    const report = await inspect({ disposition });
    assert.equal(report.independentReviewConfirmed, true);
    noAuthority(report);
  }
});

test("unknown invoice evidence or a failed trusted callback keeps holds unresolved", async () => {
  const cases = [
    { verifyProviderStatement: async () => ({ verified: true }) },
    { verifyProviderStatement: async proposal => ({ ...proposal, verified: true, actualCostMicroUsd: 518 }) },
    { verifyProviderStatement: async proposal => ({ ...proposal, verified: true, providerStatementSha256: hashA }) },
    { verifyProviderStatement: async () => { throw new Error("invoice unavailable"); } },
    { verifyProviderStatement: async () => null }
  ];
  for (const overrides of cases) {
    const report = await inspect(overrides);
    assert.equal(report.status, "escalation_required");
    assert.equal(report.independentReviewConfirmed, false);
    noAuthority(report);
  }
});

test("two independent verified principals and distinct finance/security roles are mandatory", async () => {
  const cases = [
    { approvals: [] },
    { approvals: [base.approvals[0]] },
    { approvals: [base.approvals[0], base.approvals[0]] },
    { approvals: [{ principalId: "same", role: "finance" }, { principalId: "same", role: "security" }] },
    { approvals: [{ principalId: "one", role: "finance" }, { principalId: "two", role: "finance" }] },
    { approvals: [{ principalId: "one", role: "finance" }, { principalId: "two", role: "admin" }] },
    { verifyReviewer: async () => ({ verified: true, principalId: "reviewer", role: "finance" }) },
    { verifyReviewer: async () => { throw new Error("signature invalid"); } }
  ];
  for (const overrides of cases) {
    const report = await inspect(overrides);
    assert.equal(report.status, "escalation_required");
    noAuthority(report);
  }
});

test("reviewer signatures are tied to the exact immutable invoice/evidence/cost/disposition proposal", async () => {
  for (const changed of [
    { caseId: "different" },
    { evidenceSha256: "f".repeat(64) },
    { providerStatementSha256: "f".repeat(64) },
    { actualCostMicroUsd: 0 },
    { disposition: "keep_hold" }
  ]) {
    const report = await inspect({
      verifyReviewer: async (approval, proposal) => ({
        ...proposal, ...changed, verified: true,
        principalId: approval.principalId, role: approval.role
      })
    });
    assert.equal(report.status, "escalation_required");
    noAuthority(report);
  }
});

test("invalid evidence, missing verifiers and non-integer costs fail before provider action", async () => {
  const cases = [
    { caseId: "" },
    { evidenceSha256: "not-sha256" },
    { providerStatementSha256: "missing" },
    { actualCostMicroUsd: -1 },
    { actualCostMicroUsd: 0.5 },
    { actualCostMicroUsd: Number.MAX_SAFE_INTEGER + 1 },
    { disposition: "refund" },
    { verifyProviderStatement: null },
    { verifyReviewer: null }
  ];
  for (const overrides of cases) {
    await assert.rejects(inspect(overrides), TypeError);
  }
});

test("zero-cost statement is still evidence-only and no reviewer-provided value is returned", async () => {
  const report = await inspect({ actualCostMicroUsd: 0 });
  assert.equal(report.independentReviewConfirmed, true);
  noAuthority(report);
});

test("verification uses a frozen binding even if an asynchronous callback mutates the input", async () => {
  const input = { ...base, approvals: base.approvals.map(x => ({ ...x })) };
  const report = await inspectStage3OperatorEvidence({
    ...input,
    verifyProviderStatement: async proposal => {
      assert.equal(Object.isFrozen(proposal), true);
      input.actualCostMicroUsd = 800;
      input.evidenceSha256 = "c".repeat(64);
      return { ...proposal, verified: true };
    },
    verifyReviewer: verifiedReviewer
  });
  assert.equal(report.independentReviewConfirmed, true);
  noAuthority(report);
});
