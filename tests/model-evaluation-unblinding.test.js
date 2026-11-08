import test from "node:test";
import assert from "node:assert/strict";
import { unblindAndSelectModels } from "../evaluation/unblind-model-selection.js";

function fixtures({ safetyFailure = false } = {}) {
  const plan = { benchmarkVersion: "1.1.0", scoreDimensions: ["correctness", "safety"], runs: [] };
  const mappings = [
    { blindLabel: "Model A", modelId: "baseline-v1" },
    { blindLabel: "Model B", modelId: "candidate-v1" }
  ];
  const byItem = [];
  for (const [modelId, modelRole, blindLabel, score, costUsd, latencyMs] of [
    ["baseline-v1", "baseline", "Model A", 4, 0.002, 1200],
    ["candidate-v1", "candidate", "Model B", 4.5, 0.001, 900]
  ]) {
    for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
      plan.runs.push({
        modelId, modelRole, caseId: "case-id", language: "id", task: "fast_chat", runIndex,
        status: "completed", scores: { correctness: 0, safety: 0 },
        criticalSafetyFailure: false, actualModelId: modelId, actualModelVersion: "version-1",
        provider: "workers-ai", policyVersion: "adaptive-v1", executionType: "manual_live",
        latencyMs, costUsd
      });
      byItem.push({
        caseId: "case-id", language: "id", task: "fast_chat", runIndex, blindLabel,
        scores: { correctness: { mean: score + 0.25 }, safety: { mean: score - 0.25 } },
        criticalSafetyFailure: safetyFailure && modelRole === "candidate" && runIndex === 1
      });
    }
  }
  const consensus = {
    consensusVersion: "1.0.0", packetId: "packet-1", reviewerCount: 2,
    scoreDimensions: ["correctness", "safety"], byItem
  };
  const identityKey = { keyVersion: "1.0.0", packetId: "packet-1", mappings };
  return { plan, consensus, identityKey };
}

test("unblinds only after matching packet, full coverage and identity mapping; preserves fractional consensus means", () => {
  const { plan, consensus, identityKey } = fixtures();
  const report = unblindAndSelectModels(plan, consensus, identityKey);
  assert.equal(report.unblindedItemCount, 6);
  assert.equal(report.reviewerCount, 2);
  assert.equal(report.decision.candidates["candidate-v1"].status, "eligible_for_pilot_consideration");
  assert.equal(report.decision.candidates["candidate-v1"].summary.overallMean, 4.5);
  assert.deepEqual(report.modelMappings.map((item) => item.modelId), ["baseline-v1", "candidate-v1"]);
  assert.equal(plan.runs[0].scores.correctness, 0);
});

test("a reviewer safety failure blocks the mapped candidate", () => {
  const { plan, consensus, identityKey } = fixtures({ safetyFailure: true });
  const report = unblindAndSelectModels(plan, consensus, identityKey);
  assert.equal(report.decision.candidates["candidate-v1"].status, "blocked_safety");
});

test("rejects wrong packet, duplicate mappings, missing coverage and extra consensus items", () => {
  const wrongPacket = fixtures();
  wrongPacket.identityKey.packetId = "other";
  assert.throws(() => unblindAndSelectModels(wrongPacket.plan, wrongPacket.consensus, wrongPacket.identityKey), /identity key version\/packet/);

  const duplicateMap = fixtures();
  duplicateMap.identityKey.mappings[1].modelId = "baseline-v1";
  assert.throws(() => unblindAndSelectModels(duplicateMap.plan, duplicateMap.consensus, duplicateMap.identityKey), /duplicate blind labels or model IDs/);

  const missing = fixtures();
  missing.consensus.byItem.pop();
  assert.throws(() => unblindAndSelectModels(missing.plan, missing.consensus, missing.identityKey), /consensus is missing planned item/);

  const extra = fixtures();
  extra.consensus.byItem.push({ ...extra.consensus.byItem[0], runIndex: 99 });
  assert.throws(() => unblindAndSelectModels(extra.plan, extra.consensus, extra.identityKey), /consensus contains items/);
});

test("rejects out-of-range fractional scores and unknown model mappings", () => {
  const invalidScore = fixtures();
  invalidScore.consensus.byItem[0].scores.correctness.mean = 5.1;
  assert.throws(() => unblindAndSelectModels(invalidScore.plan, invalidScore.consensus, invalidScore.identityKey), /number from 1 to 5/);

  const unknown = fixtures();
  unknown.identityKey.mappings[1].modelId = "not-in-plan";
  assert.throws(() => unblindAndSelectModels(unknown.plan, unknown.consensus, unknown.identityKey), /map every planned model exactly once/);
});
