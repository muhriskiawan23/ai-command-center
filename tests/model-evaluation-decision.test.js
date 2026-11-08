import test from "node:test";
import assert from "node:assert/strict";
import { decideModelAdvancement } from "../evaluation/decide-model-advancement.js";

const dimensions = ["correctness", "safety"];
function buildPlan({ candidateScore = 5, baselineScore = 4, candidateCost = 0.001, baselineCost = 0.002,
  candidateLatency = 900, baselineLatency = 1200, safetyFailure = false, missingCost = false,
  executionType = "manual_live", pendingCandidate = false } = {}) {
  const runs = [];
  for (const [modelId, modelRole, score, costUsd, latencyMs] of [
    ["baseline-v1", "baseline", baselineScore, baselineCost, baselineLatency],
    ["candidate-v1", "candidate", candidateScore, candidateCost, candidateLatency]
  ]) {
    for (const caseId of ["case-id", "case-en"]) {
      for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
        const completed = !(pendingCandidate && modelRole === "candidate" && caseId === "case-en" && runIndex === 3);
        runs.push({
          modelId, modelRole, caseId, language: caseId.endsWith("id") ? "id" : "en",
          task: caseId === "case-id" ? "fast_chat" : "coding", runIndex,
          status: completed ? "completed" : "pending",
          scores: { correctness: score, safety: score },
          criticalSafetyFailure: modelRole === "candidate" && safetyFailure,
          actualModelId: modelId, actualModelVersion: "version-1", provider: "workers-ai",
          policyVersion: "adaptive-v1", executionType,
          latencyMs, costUsd: missingCost && modelRole === "candidate" ? null : costUsd
        });
      }
    }
  }
  return { benchmarkVersion: "1.1.0", scoreDimensions: dimensions, minimumRunsPerCase: 3, runs };
}

test("allows pilot consideration only after all live evidence gates and paired quality improvement", () => {
  const report = decideModelAdvancement(buildPlan());
  assert.equal(report.candidates["candidate-v1"].status, "eligible_for_pilot_consideration");
  assert.equal(report.candidates["candidate-v1"].pairedComparison.pairedRuns, 6);
  assert.equal(report.candidates["candidate-v1"].gates.qualityAdvantage, true);
});

test("blocks any critical safety failure regardless of average score", () => {
  const report = decideModelAdvancement(buildPlan({ safetyFailure: true }));
  assert.equal(report.candidates["candidate-v1"].status, "blocked_safety");
});

test("rejects completed evidence whose actual model ID differs from the planned model", () => {
  const plan = buildPlan();
  plan.runs.find((run) => run.modelRole === "candidate" && run.status === "completed").actualModelId = "different-provider-model";
  assert.throws(() => decideModelAdvancement(plan), /actualModelId must match planned modelId/);
});

test("keeps mocked evidence out of live advancement decisions", () => {
  assert.throws(() => decideModelAdvancement(buildPlan({ executionType: "manual_mocked" })), /only manual_live/);
});

test("unknown cost cannot create a cost advantage", () => {
  const report = decideModelAdvancement(buildPlan({ candidateScore: 4, baselineScore: 4, missingCost: true,
    candidateLatency: 1200, baselineLatency: 1200 }));
  assert.equal(report.candidates["candidate-v1"].gates.costAdvantage, false);
  assert.equal(report.candidates["candidate-v1"].status, "retain_baseline");
});

test("incomplete runs remain visible and make the comparison inconclusive", () => {
  const report = decideModelAdvancement(buildPlan({ pendingCandidate: true }));
  assert.equal(report.candidates["candidate-v1"].summary.pending, 1);
  assert.equal(report.candidates["candidate-v1"].status, "inconclusive");
});

test("rejects duplicate runs, absent baseline, and invalid decision thresholds", () => {
  const duplicate = buildPlan();
  duplicate.runs.push({ ...duplicate.runs[0] });
  assert.throws(() => decideModelAdvancement(duplicate), /duplicate evaluation run/);
  const noBaseline = buildPlan();
  noBaseline.runs.forEach((run) => { run.modelRole = "candidate"; });
  assert.throws(() => decideModelAdvancement(noBaseline), /exactly one baseline/);
  assert.throws(() => decideModelAdvancement(buildPlan(), { minimumCompletionRate: 1.5 }), /invalid thresholds/);
  const mixedRole = buildPlan();
  mixedRole.runs[0].modelRole = "candidate";
  assert.throws(() => decideModelAdvancement(mixedRole), /inconsistent modelRole/);
  const unsafeIncomplete = buildPlan({ safetyFailure: true, pendingCandidate: true });
  assert.equal(decideModelAdvancement(unsafeIncomplete).candidates["candidate-v1"].status, "blocked_safety");
});

test("rejects mixed provider or routing-policy metadata within candidate evidence", () => {
  const mixedProvider = buildPlan();
  mixedProvider.runs.find((run) => run.modelRole === "candidate" && run.status === "completed").provider = "other-provider";
  const providerReport = decideModelAdvancement(mixedProvider);
  assert.equal(providerReport.candidates["candidate-v1"].gates.evidencePass, false);
  assert.equal(providerReport.candidates["candidate-v1"].status, "inconclusive");

  const mixedPolicy = buildPlan();
  mixedPolicy.runs.find((run) => run.modelRole === "candidate" && run.status === "completed").policyVersion = "different-policy";
  const policyReport = decideModelAdvancement(mixedPolicy);
  assert.equal(policyReport.candidates["candidate-v1"].gates.evidencePass, false);
  assert.equal(policyReport.candidates["candidate-v1"].status, "inconclusive");
});

test("requires consistent baseline model version, provider, and routing policy", () => {
  for (const [field, value] of [
    ["actualModelVersion", "different-version"],
    ["provider", "other-provider"],
    ["policyVersion", "different-policy"]
  ]) {
    const plan = buildPlan();
    plan.runs.find((run) => run.modelRole === "baseline" && run.status === "completed")[field] = value;
    const report = decideModelAdvancement(plan);
    assert.equal(report.candidates["candidate-v1"].gates.baselineEvidencePass, false, field);
    assert.equal(report.candidates["candidate-v1"].status, "inconclusive", field);
  }
});

test("rejects unknown model roles", () => {
  const plan = buildPlan();
  plan.runs[0].modelRole = "control";
  assert.throws(() => decideModelAdvancement(plan), /modelRole must be baseline or candidate/);
});
