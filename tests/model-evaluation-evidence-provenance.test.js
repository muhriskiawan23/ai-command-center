import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  canonicalJson,
  createEvidenceEnvelope,
  verifyEvidenceEnvelope
} from "../evaluation/evidence-provenance.js";

function buildPlan() {
  const runs = [];
  for (const [modelId, modelRole] of [["baseline-v1", "baseline"], ["candidate-v1", "candidate"]]) {
    for (let runIndex = 1; runIndex <= 3; runIndex += 1) {
      runs.push({
        modelId, modelRole, caseId: "case-id", language: "id", task: "fast_chat", runIndex,
        status: "completed", scores: { correctness: 4 }, criticalSafetyFailure: false,
        actualModelId: modelId, actualModelVersion: "version-1", provider: "workers-ai",
        policyVersion: "adaptive-v1", executionType: "manual_live",
        startedAt: "2026-11-08T10:00:00.000Z", completedAt: "2026-11-08T10:00:01.000Z",
        latencyMs: 1000, inputTokens: 10, outputTokens: 20, costUsd: 0.001,
        failureReason: "", modelOutput: "A reviewed response"
      });
    }
  }
  return {
    planVersion: "1.0.0", benchmarkVersion: "1.1.0",
    scoreDimensions: ["correctness"], runs
  };
}

function keys() {
  return generateKeyPairSync("ed25519");
}

test("canonical JSON is stable regardless of object key insertion order", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: true, b: null } }),
    canonicalJson({ a: { b: null, y: true }, z: 1 }));
});

test("signs and verifies an evaluation envelope with a trusted Ed25519 key", () => {
  const pair = keys();
  const envelope = createEvidenceEnvelope(buildPlan(), pair.privateKey, {
    signedAt: "2026-11-08T12:00:00.000Z"
  });
  const result = verifyEvidenceEnvelope(envelope, pair.publicKey);
  assert.equal(result.valid, true);
  assert.equal(result.summary.runCount, 6);
  assert.equal(result.summary.completedRuns, 6);
  assert.equal(result.summary.evidenceTypes[0], "manual_live");
});

test("signs raw completed evidence before reviewers fill scores and safety flags", () => {
  const pair = keys();
  const plan = buildPlan();
  for (const run of plan.runs) {
    run.scores.correctness = null;
    run.criticalSafetyFailure = null;
  }
  const envelope = createEvidenceEnvelope(plan, pair.privateKey);
  const result = verifyEvidenceEnvelope(envelope, pair.publicKey);
  assert.equal(result.valid, true);
  assert.equal(result.summary.completedRuns, 6);
});

test("rejects payload tampering even when the changed value remains valid JSON", () => {
  const pair = keys();
  const envelope = createEvidenceEnvelope(buildPlan(), pair.privateKey);
  envelope.payload.runs[0].scores.correctness = 1;
  assert.throws(() => verifyEvidenceEnvelope(envelope, pair.publicKey), /payload hash mismatch/);
});

test("rejects changes to the unsigned display summary", () => {
  const pair = keys();
  const envelope = createEvidenceEnvelope(buildPlan(), pair.privateKey);
  envelope.summary.completedRuns = 0;
  assert.throws(() => verifyEvidenceEnvelope(envelope, pair.publicKey), /summary mismatch/);
});

test("rejects a public key that is not the trusted signer for the envelope", () => {
  const signer = keys();
  const other = keys();
  const envelope = createEvidenceEnvelope(buildPlan(), signer.privateKey);
  assert.throws(() => verifyEvidenceEnvelope(envelope, other.publicKey), /fingerprint does not match/);
});

test("rejects mixed model/provider/policy provenance before signing", () => {
  const pair = keys();
  const plan = buildPlan();
  plan.runs[1].provider = "other-provider";
  assert.throws(() => createEvidenceEnvelope(plan, pair.privateKey), /mixed model\/provider\/policy provenance/);
});

test("rejects pending or unknown-role evidence from a final signed record", () => {
  const pair = keys();
  const pending = buildPlan();
  pending.runs[0].status = "pending";
  assert.throws(() => createEvidenceEnvelope(pending, pair.privateKey), /status must be completed, failed, or skipped/);

  const unknownRole = buildPlan();
  unknownRole.runs[0].modelRole = "control";
  assert.throws(() => createEvidenceEnvelope(unknownRole, pair.privateKey), /modelRole must be baseline or candidate/);

  const mixedRole = buildPlan();
  mixedRole.runs[0].modelRole = "candidate";
  assert.throws(() => createEvidenceEnvelope(mixedRole, pair.privateKey), /inconsistent modelRole values/);
});
