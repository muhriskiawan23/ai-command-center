import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createEvidenceEnvelope } from "../evaluation/evidence-provenance.js";
import { unblindAndSelectModels } from "../evaluation/unblind-model-selection.js";

function fixtures({ safetyFailure = false, failedCandidateRun = false } = {}) {
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
        status: "completed", scores: { correctness: null, safety: null },
        criticalSafetyFailure: null, actualModelId: modelId, actualModelVersion: "version-1",
        provider: "workers-ai", policyVersion: "adaptive-v1", executionType: "manual_live",
        startedAt: "2026-11-08T10:00:00.000Z", completedAt: "2026-11-08T10:00:01.000Z",
        latencyMs, inputTokens: 100, outputTokens: 200, costUsd,
        failureReason: "", modelOutput: `Recorded output for ${modelId} run ${runIndex}`
      });
      byItem.push({
        caseId: "case-id", language: "id", task: "fast_chat", runIndex, blindLabel,
        scores: { correctness: { mean: score + 0.25 }, safety: { mean: score - 0.25 } },
        criticalSafetyFailure: safetyFailure && modelRole === "candidate" && runIndex === 1
      });
    }
  }
  if (failedCandidateRun) {
    const failedRun = plan.runs.find((run) => run.modelId === "candidate-v1" && run.runIndex === 3);
    failedRun.status = "failed";
    failedRun.failureReason = "provider timeout";
    failedRun.modelOutput = null;
    const candidateLabel = mappings.find((mapping) => mapping.modelId === "candidate-v1").blindLabel;
    const failedItemIndex = byItem.findIndex((item) => item.blindLabel === candidateLabel && item.runIndex === 3);
    byItem.splice(failedItemIndex, 1);
  }
  const consensus = {
    consensusVersion: "1.0.0", packetId: "packet-1", reviewerCount: 2,
    scoreDimensions: ["correctness", "safety"], byItem
  };
  const identityKey = { keyVersion: "1.0.0", packetId: "packet-1", mappings };
  const signingKeys = generateKeyPairSync("ed25519");
  const evidenceEnvelope = createEvidenceEnvelope(plan, signingKeys.privateKey, {
    signedAt: "2026-11-08T12:00:00.000Z"
  });
  return { plan, consensus, identityKey, evidenceEnvelope, trustedPublicKey: signingKeys.publicKey };
}

function unblind(fixture) {
  return unblindAndSelectModels(
    fixture.plan, fixture.consensus, fixture.identityKey,
    fixture.evidenceEnvelope, fixture.trustedPublicKey
  );
}

test("unblinds only after signature verification, matching packet, full coverage and identity mapping", () => {
  const fixture = fixtures();
  const report = unblind(fixture);
  assert.equal(report.unblindedItemCount, 6);
  assert.equal(report.reviewerCount, 2);
  assert.equal(report.decision.candidates["candidate-v1"].status, "eligible_for_pilot_consideration");
  assert.equal(report.decision.candidates["candidate-v1"].summary.overallMean, 4.5);
  assert.deepEqual(report.modelMappings.map((item) => item.modelId), ["baseline-v1", "candidate-v1"]);
  assert.equal(report.evidenceAttestation.keyId, fixture.evidenceEnvelope.keyId);
  assert.equal(report.evidenceAttestation.payloadSha256, fixture.evidenceEnvelope.payloadSha256);
  assert.equal(fixture.plan.runs[0].scores.correctness, null);
});

test("signed raw evidence can be verified before reviewer scores are added", () => {
  const fixture = fixtures();
  assert.ok(fixture.plan.runs.every((run) => run.scores.correctness === null && run.criticalSafetyFailure === null));
  assert.doesNotThrow(() => unblind(fixture));
});

test("a reviewer safety failure blocks the mapped candidate", () => {
  const fixture = fixtures({ safetyFailure: true });
  const report = unblind(fixture);
  assert.equal(report.decision.candidates["candidate-v1"].status, "blocked_safety");
});

test("preserves failed runs without asking reviewers to score missing model outputs", () => {
  const fixture = fixtures({ failedCandidateRun: true });
  const report = unblind(fixture);
  assert.equal(report.unblindedItemCount, 5);
  assert.equal(report.plannedRunCount, 6);
  assert.equal(report.failedRunCount, 1);
  assert.equal(report.skippedRunCount, 0);
  assert.equal(report.decision.candidates["candidate-v1"].status, "inconclusive");
  assert.equal(report.decision.candidates["candidate-v1"].summary.completionRate, 2 / 3);
});

test("refuses to unblind without a signed envelope and trusted public key", () => {
  const fixture = fixtures();
  assert.throws(
    () => unblindAndSelectModels(fixture.plan, fixture.consensus, fixture.identityKey),
    /signed evidence envelope and independently trusted public key are required/
  );
});

test("rejects a worksheet changed after evidence signing", () => {
  const fixture = fixtures();
  fixture.plan.runs[0].modelOutput = "tampered response";
  assert.throws(() => unblind(fixture), /does not match the signed evidence payload/);
});

test("rejects an envelope signed by a key that is not independently trusted", () => {
  const fixture = fixtures();
  const otherKey = generateKeyPairSync("ed25519").publicKey;
  assert.throws(() => unblindAndSelectModels(
    fixture.plan, fixture.consensus, fixture.identityKey,
    fixture.evidenceEnvelope, otherKey
  ), /fingerprint does not match/);
});

test("rejects wrong packet, duplicate mappings, missing coverage and extra consensus items", () => {
  const wrongPacket = fixtures();
  wrongPacket.identityKey.packetId = "other";
  assert.throws(() => unblind(wrongPacket), /identity key version\/packet/);

  const duplicateMap = fixtures();
  duplicateMap.identityKey.mappings[1].modelId = "baseline-v1";
  assert.throws(() => unblind(duplicateMap), /duplicate blind labels or model IDs/);

  const missing = fixtures();
  missing.consensus.byItem.pop();
  assert.throws(() => unblind(missing), /consensus is missing planned item/);

  const extra = fixtures();
  extra.consensus.byItem.push({ ...extra.consensus.byItem[0], runIndex: 99 });
  assert.throws(() => unblind(extra), /consensus contains items/);
});

test("rejects out-of-range fractional scores and unknown model mappings", () => {
  const invalidScore = fixtures();
  invalidScore.consensus.byItem[0].scores.correctness.mean = 5.1;
  assert.throws(() => unblind(invalidScore), /number from 1 to 5/);

  const unknown = fixtures();
  unknown.identityKey.mappings[1].modelId = "not-in-plan";
  assert.throws(() => unblind(unknown), /map every planned model exactly once/);
});
