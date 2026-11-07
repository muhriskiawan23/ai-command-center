import test from "node:test";
import assert from "node:assert/strict";
import {
  BASELINE_MODEL_CATALOG,
  DEFAULT_MODEL_ID,
  NoEligibleModelError,
  evaluateModelCandidates,
  selectModel
} from "../src/model-gateway.js";

function candidate(overrides = {}) {
  return {
    id: "test/model",
    provider: "cloudflare-workers-ai",
    adapter: "test",
    capabilities: ["text"],
    contextWindowTokens: 16000,
    maxOutputTokens: 4000,
    regions: ["global"],
    dataPolicies: ["approved"],
    inputCostPerMillionUsd: 1,
    outputCostPerMillionUsd: 2,
    p95LatencyMs: 800,
    reliability: 0.99,
    qualityScores: { fast_chat: 0.9, deep_reasoning: 0.8 },
    status: "enabled",
    external: false,
    ...overrides
  };
}

test("baseline catalog contains only the audited Workers AI model", () => {
  assert.equal(BASELINE_MODEL_CATALOG.length, 1);
  assert.equal(BASELINE_MODEL_CATALOG[0].id, DEFAULT_MODEL_ID);
  assert.equal(BASELINE_MODEL_CATALOG[0].provider, "cloudflare-workers-ai");
});

test("adaptive selection can choose the sole eligible baseline for text chat", () => {
  const result = selectModel({ task: "fast_chat" });
  assert.equal(result.model.id, DEFAULT_MODEL_ID);
  assert.equal(result.policyVersion, "adaptive-v1");
  assert.equal(result.evidence.quality, "unknown");
  assert.equal(result.evidence.cost, "unknown");
});

test("rejects a model when required modality is not verified", () => {
  const result = evaluateModelCandidates({ task: "multimodal_vision", models: [candidate()] });
  assert.equal(result.eligible.length, 0);
  assert.match(result.rejected[0].reason, /missing_capabilities/);
});

test("rejects audio task when model has no verified audio capability", () => {
  assert.throws(
    () => selectModel({ task: "audio", models: [candidate()] }),
    (error) => error instanceof NoEligibleModelError && error.code === "NO_ELIGIBLE_MODEL"
  );
});

test("does not route to an external provider without explicit approval and consent", () => {
  const external = candidate({ id: "external/model", provider: "external-test-provider", approved: true });
  const denied = evaluateModelCandidates({ task: "fast_chat", models: [external] });
  assert.equal(denied.eligible.length, 0);
  assert.equal(denied.rejected[0].reason, "external_provider_not_approved");

  const approved = selectModel({
    task: "fast_chat",
    models: [external],
    constraints: { approvedProviders: ["external-test-provider"], userConsent: true }
  });
  assert.equal(approved.model.id, external.id);
});

test("fails closed when required context size is not verified", () => {
  const baseline = candidate({ contextWindowTokens: null });
  const result = evaluateModelCandidates({
    task: "deep_reasoning",
    models: [baseline],
    requirements: { inputTokens: 12000 }
  });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.rejected[0].reason, "context_limit_unverified_or_exceeded");
});

test("fails closed when a deadline is set but latency is unknown or too high", () => {
  const unknownLatency = candidate({ p95LatencyMs: null });
  const tooSlow = candidate({ p95LatencyMs: 5000 });
  const unknown = evaluateModelCandidates({
    task: "fast_chat", models: [unknownLatency], constraints: { deadlineMs: 1500 }
  });
  const slow = evaluateModelCandidates({
    task: "fast_chat", models: [tooSlow], constraints: { deadlineMs: 1500 }
  });
  assert.equal(unknown.eligible.length, 0);
  assert.equal(unknown.rejected[0].reason, "deadline_unverified_or_not_feasible");
  assert.equal(slow.eligible.length, 0);
  assert.equal(slow.rejected[0].reason, "deadline_unverified_or_not_feasible");
});

test("fails closed when a cost ceiling is set without token estimates", () => {
  const result = evaluateModelCandidates({
    task: "fast_chat",
    models: [candidate()],
    constraints: { maxCostUsd: 0.01 }
  });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.rejected[0].reason, "cost_unverified_or_over_budget");
});

test("fails closed when the requested output exceeds an unverified or configured limit", () => {
  const unknown = candidate({ maxOutputTokens: null });
  const result = evaluateModelCandidates({
    task: "fast_chat", models: [unknown], requirements: { outputTokens: 5000 }
  });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.rejected[0].reason, "output_limit_unverified_or_exceeded");
});

test("fails closed when requested region or data policy is unverified", () => {
  const model = candidate({ regions: [], dataPolicies: [] });
  const region = evaluateModelCandidates({
    task: "fast_chat", models: [model], constraints: { region: "apac" }
  });
  const policy = evaluateModelCandidates({
    task: "fast_chat", models: [model], constraints: { dataPolicy: "approved" }
  });
  assert.equal(region.eligible.length, 0);
  assert.equal(region.rejected[0].reason, "region_unverified_or_unsupported");
  assert.equal(policy.eligible.length, 0);
  assert.equal(policy.rejected[0].reason, "data_policy_unverified_or_incompatible");
});

test("does not accept unknown quality or price when hard floors are requested", () => {
  const unknown = candidate({ qualityScores: {}, inputCostPerMillionUsd: null, outputCostPerMillionUsd: null });
  const quality = evaluateModelCandidates({
    task: "fast_chat", models: [unknown], requirements: { minQualityScore: 0.7 }
  });
  const budget = evaluateModelCandidates({
    task: "fast_chat", models: [unknown], requirements: { inputTokens: 1000, outputTokens: 1000 },
    constraints: { maxCostUsd: 0.01 }
  });
  assert.equal(quality.eligible.length, 0);
  assert.equal(quality.rejected[0].reason, "quality_floor_unverified_or_not_met");
  assert.equal(budget.eligible.length, 0);
  assert.equal(budget.rejected[0].reason, "cost_unverified_or_over_budget");
});

test("adaptive scoring prioritizes measured quality, then cost and latency", () => {
  const cheaper = candidate({
    id: "cheap",
    qualityScores: { fast_chat: 0.8 },
    inputCostPerMillionUsd: 0.1,
    outputCostPerMillionUsd: 0.1,
    p95LatencyMs: 300
  });
  const stronger = candidate({
    id: "stronger",
    qualityScores: { fast_chat: 0.95 },
    inputCostPerMillionUsd: 4,
    outputCostPerMillionUsd: 8,
    p95LatencyMs: 1200
  });
  assert.equal(selectModel({ task: "fast_chat", models: [cheaper, stronger] }).model.id, "stronger");
});

test("cost and latency break ties when quality and reliability are equal", () => {
  const slower = candidate({ id: "slower", p95LatencyMs: 1800 });
  const faster = candidate({ id: "faster", p95LatencyMs: 400 });
  assert.equal(selectModel({ task: "fast_chat", models: [slower, faster] }).model.id, "faster");
});

test("rejects malformed routing constraints instead of silently ignoring them", () => {
  assert.throws(
    () => evaluateModelCandidates({
      task: "fast_chat", models: [candidate()], requirements: { inputTokens: "1000" }
    }),
    /requirements.inputTokens must be a finite non-negative number/
  );
  assert.throws(
    () => evaluateModelCandidates({
      task: "fast_chat", models: [candidate()], requirements: { capabilities: "vision" }
    }),
    /requirements.capabilities must be an array/
  );
  assert.throws(
    () => evaluateModelCandidates({
      task: "fast_chat", models: [candidate()], requirements: { minQualityScore: 1.5 }
    }),
    /minQualityScore must be between 0 and 1/
  );
  assert.throws(
    () => evaluateModelCandidates({
      task: "fast_chat", models: [candidate()], constraints: { deadlineMs: -1 }
    }),
    /constraints.deadlineMs must be a finite non-negative number/
  );
  assert.throws(
    () => evaluateModelCandidates({
      task: "fast_chat", models: [candidate()], constraints: { maxCostUsd: "0.01" }
    }),
    /constraints.maxCostUsd must be a finite non-negative number/
  );
  assert.throws(
    () => evaluateModelCandidates({
      task: "fast_chat", models: [candidate()], constraints: { approvedProviders: "provider" }
    }),
    /approvedProviders must be an array/
  );
});

test("rejects disabled models and unknown task profiles", () => {
  const disabled = evaluateModelCandidates({
    task: "fast_chat", models: [candidate({ status: "disabled" })]
  });
  assert.equal(disabled.eligible.length, 0);
  assert.equal(disabled.rejected[0].reason, "model_disabled");
  assert.throws(() => selectModel({ task: "made_up_task" }), /Unknown task profile/);
});


test("rejects malformed routing limits instead of silently ignoring them", () => {
  assert.throws(
    () => evaluateModelCandidates({
      task: "fast_chat", models: [candidate()], constraints: { deadlineMs: "1500" }
    }),
    /constraints.deadlineMs must be a finite non-negative number/
  );
  assert.throws(
    () => evaluateModelCandidates({
      task: "fast_chat", models: [candidate()], constraints: { maxCostUsd: "0.01" }
    }),
    /constraints.maxCostUsd must be a finite non-negative number/
  );
  assert.throws(
    () => evaluateModelCandidates({
      task: "fast_chat", models: [candidate()], requirements: { inputTokens: -1 }
    }),
    /requirements.inputTokens must be a non-negative safe integer/
  );
  assert.throws(
    () => evaluateModelCandidates({
      task: "fast_chat", models: [candidate()], requirements: { outputTokens: 1.5 }
    }),
    /requirements.outputTokens must be a non-negative safe integer/
  );
  assert.throws(
    () => evaluateModelCandidates({
      task: "fast_chat", models: [candidate()], requirements: { minQualityScore: 1.5 }
    }),
    /requirements.minQualityScore must be between 0 and 1/
  );
});
