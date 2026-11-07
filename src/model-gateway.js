export const MODEL_ROUTING_POLICY_VERSION = "adaptive-v1";
export const DEFAULT_MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const TASK_PROFILES = Object.freeze({
  fast_chat: Object.freeze({ requiredCapabilities: Object.freeze(["text"]) }),
  deep_reasoning: Object.freeze({ requiredCapabilities: Object.freeze(["text"]) }),
  research_synthesis: Object.freeze({ requiredCapabilities: Object.freeze(["text"]) }),
  coding: Object.freeze({ requiredCapabilities: Object.freeze(["text"]) }),
  translation: Object.freeze({ requiredCapabilities: Object.freeze(["text"]) }),
  multimodal_vision: Object.freeze({ requiredCapabilities: Object.freeze(["text", "vision"]) }),
  audio: Object.freeze({ requiredCapabilities: Object.freeze(["audio"]) }),
  structured_extraction: Object.freeze({ requiredCapabilities: Object.freeze(["text", "structured-output"]) })
});

// Audited baseline only. Null/empty fields are deliberately unknown, not inferred.
export const BASELINE_MODEL_CATALOG = Object.freeze([
  Object.freeze({
    id: DEFAULT_MODEL_ID,
    provider: "cloudflare-workers-ai",
    adapter: "workers-ai",
    capabilities: Object.freeze(["text"]),
    contextWindowTokens: null,
    maxOutputTokens: null,
    regions: Object.freeze([]),
    dataPolicies: Object.freeze([]),
    inputCostPerMillionUsd: null,
    outputCostPerMillionUsd: null,
    p95LatencyMs: null,
    reliability: null,
    qualityScores: Object.freeze({}),
    status: "enabled",
    external: false
  })
]);

export class NoEligibleModelError extends Error {
  constructor(task, reasons = []) {
    super(`No eligible model is available for task profile: ${task}`);
    this.name = "NoEligibleModelError";
    this.code = "NO_ELIGIBLE_MODEL";
    this.task = task;
    this.reasons = reasons;
  }
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateRoutingInputs(requirements, constraints) {
  if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) {
    throw new TypeError("requirements must be an object");
  }
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) {
    throw new TypeError("constraints must be an object");
  }
  for (const key of ["inputTokens", "outputTokens"]) {
    if (Object.hasOwn(requirements, key) &&
        (!Number.isSafeInteger(requirements[key]) || requirements[key] < 0)) {
      throw new TypeError(`requirements.${key} must be a non-negative safe integer`);
    }
  }
  if (Object.hasOwn(requirements, "minQualityScore") &&
      (!finiteNumber(requirements.minQualityScore) ||
       requirements.minQualityScore < 0 || requirements.minQualityScore > 1)) {
    throw new TypeError("requirements.minQualityScore must be between 0 and 1");
  }
  if (Object.hasOwn(requirements, "capabilities") &&
      (!Array.isArray(requirements.capabilities) ||
       requirements.capabilities.some((value) => typeof value !== "string" || !value.trim()))) {
    throw new TypeError("requirements.capabilities must be an array of non-empty strings");
  }
  for (const key of ["deadlineMs", "maxCostUsd"]) {
    if (Object.hasOwn(constraints, key) &&
        (!finiteNumber(constraints[key]) || constraints[key] < 0)) {
      throw new TypeError(`constraints.${key} must be a finite non-negative number`);
    }
  }
  for (const key of ["region", "dataPolicy"]) {
    if (Object.hasOwn(constraints, key) &&
        (typeof constraints[key] !== "string" || !constraints[key].trim())) {
      throw new TypeError(`constraints.${key} must be a non-empty string`);
    }
  }
  if (Object.hasOwn(constraints, "approvedProviders") &&
      (!Array.isArray(constraints.approvedProviders) ||
       constraints.approvedProviders.some((value) => typeof value !== "string" || !value.trim()))) {
    throw new TypeError("constraints.approvedProviders must be an array of non-empty strings");
  }
  if (Object.hasOwn(constraints, "userConsent") && typeof constraints.userConsent !== "boolean") {
    throw new TypeError("constraints.userConsent must be a boolean");
  }
}

function validateRoutingOptions(requirements, constraints) {
  if (!requirements || typeof requirements !== "object" || Array.isArray(requirements)) {
    throw new TypeError("requirements must be an object");
  }
  if (!constraints || typeof constraints !== "object" || Array.isArray(constraints)) {
    throw new TypeError("constraints must be an object");
  }

  if (requirements.capabilities !== undefined &&
      (!Array.isArray(requirements.capabilities) ||
       requirements.capabilities.some((value) => typeof value !== "string" || !value.trim()))) {
    throw new TypeError("requirements.capabilities must be an array of non-empty strings");
  }
  for (const key of ["inputTokens", "outputTokens"]) {
    if (requirements[key] !== undefined &&
        (!finiteNumber(requirements[key]) || requirements[key] < 0)) {
      throw new TypeError(`requirements.${key} must be a finite non-negative number`);
    }
  }
  if (requirements.minQualityScore !== undefined &&
      (!finiteNumber(requirements.minQualityScore) ||
       requirements.minQualityScore < 0 || requirements.minQualityScore > 1)) {
    throw new TypeError("requirements.minQualityScore must be between 0 and 1");
  }
  for (const key of ["deadlineMs", "maxCostUsd"]) {
    if (constraints[key] !== undefined &&
        (!finiteNumber(constraints[key]) || constraints[key] < 0)) {
      throw new TypeError(`constraints.${key} must be a finite non-negative number`);
    }
  }
  for (const key of ["region", "dataPolicy"]) {
    if (constraints[key] !== undefined &&
        (typeof constraints[key] !== "string" || !constraints[key].trim())) {
      throw new TypeError(`constraints.${key} must be a non-empty string`);
    }
  }
  if (constraints.approvedProviders !== undefined &&
      (!Array.isArray(constraints.approvedProviders) ||
       constraints.approvedProviders.some((value) => typeof value !== "string" || !value.trim()))) {
    throw new TypeError("constraints.approvedProviders must be an array of non-empty strings");
  }
  if (constraints.userConsent !== undefined && typeof constraints.userConsent !== "boolean") {
    throw new TypeError("constraints.userConsent must be a boolean");
  }
}

function isExternalProvider(model) {
  return model.external === true || model.provider !== "cloudflare-workers-ai";
}

function estimateCostUsd(model, inputTokens, outputTokens) {
  if (!finiteNumber(inputTokens) || inputTokens < 0 || !finiteNumber(outputTokens) || outputTokens < 0) return null;
  if (!finiteNumber(model.inputCostPerMillionUsd) || model.inputCostPerMillionUsd < 0 ||
      !finiteNumber(model.outputCostPerMillionUsd) || model.outputCostPerMillionUsd < 0) return null;
  return (inputTokens * model.inputCostPerMillionUsd + outputTokens * model.outputCostPerMillionUsd) / 1_000_000;
}

function scoreCandidate(model, task, inputTokens, outputTokens) {
  const quality = model.qualityScores?.[task];
  const reliability = model.reliability;
  const latency = model.p95LatencyMs;
  const qualityScore = finiteNumber(quality) ? Math.max(0, Math.min(1, quality)) : 0.5;
  const reliabilityScore = finiteNumber(reliability) ? Math.max(0, Math.min(1, reliability)) : 0.5;
  const latencyScore = finiteNumber(latency) && latency >= 0 ? 1 / (1 + latency / 1000) : 0.5;
  const estimatedCost = estimateCostUsd(model, inputTokens, outputTokens);
  const costScore = estimatedCost !== null ? 1 / (1 + estimatedCost * 1000) : 0.5;
  return {
    // Quality dominates; cost and latency decide among similarly capable models.
    score: qualityScore * 0.75 + reliabilityScore * 0.15 + latencyScore * 0.05 + costScore * 0.05,
    evidence: {
      quality: finiteNumber(quality) ? "measured" : "unknown",
      reliability: finiteNumber(reliability) ? "measured" : "unknown",
      latency: finiteNumber(latency) ? "measured" : "unknown",
      cost: estimatedCost !== null ? "configured" : "unknown"
    },
    estimatedCostUsd: estimatedCost
  };
}

export function evaluateModelCandidates({
  task,
  models = BASELINE_MODEL_CATALOG,
  requirements = {},
  constraints = {}
} = {}) {
  const profile = TASK_PROFILES[task];
  if (!profile) throw new TypeError(`Unknown task profile: ${task}`);
  if (!Array.isArray(models)) throw new TypeError("models must be an array");
  validateRoutingInputs(requirements, constraints);
  validateRoutingOptions(requirements, constraints);

  const requiredCapabilities = [...new Set([
    ...profile.requiredCapabilities,
    ...(Array.isArray(requirements.capabilities) ? requirements.capabilities : [])
  ])];
  const rejected = [];
  const eligible = [];

  for (const model of models) {
    const reject = (reason) => rejected.push({ modelId: model?.id || "unknown", reason });
    if (!model || typeof model.id !== "string" || !model.id || typeof model.provider !== "string") {
      reject("invalid_model_metadata"); continue;
    }
    if (model.status !== "enabled") { reject("model_disabled"); continue; }
    const capabilities = Array.isArray(model.capabilities) ? model.capabilities : [];
    const missing = requiredCapabilities.filter((capability) => !capabilities.includes(capability));
    if (missing.length) { reject(`missing_capabilities:${missing.join(",")}`); continue; }

    if (Object.hasOwn(requirements, "inputTokens") &&
        (!finiteNumber(model.contextWindowTokens) || requirements.inputTokens > model.contextWindowTokens)) {
      reject("context_limit_unverified_or_exceeded"); continue;
    }
    if (Object.hasOwn(requirements, "outputTokens") &&
        (!finiteNumber(model.maxOutputTokens) || requirements.outputTokens > model.maxOutputTokens)) {
      reject("output_limit_unverified_or_exceeded"); continue;
    }
    if (constraints.region &&
        (!Array.isArray(model.regions) || !(model.regions.includes(constraints.region) || model.regions.includes("global")))) {
      reject("region_unverified_or_unsupported"); continue;
    }
    if (isExternalProvider(model) &&
        !(model.approved === true && Array.isArray(constraints.approvedProviders) &&
          constraints.approvedProviders.includes(model.provider) && constraints.userConsent === true)) {
      reject("external_provider_not_approved"); continue;
    }
    if (constraints.dataPolicy &&
        (!Array.isArray(model.dataPolicies) || !model.dataPolicies.includes(constraints.dataPolicy))) {
      reject("data_policy_unverified_or_incompatible"); continue;
    }
    if (Object.hasOwn(constraints, "deadlineMs") &&
        (!finiteNumber(model.p95LatencyMs) || model.p95LatencyMs < 0 || model.p95LatencyMs > constraints.deadlineMs)) {
      reject("deadline_unverified_or_not_feasible"); continue;
    }
    if (Object.hasOwn(constraints, "maxCostUsd")) {
      const cost = estimateCostUsd(model, requirements.inputTokens, requirements.outputTokens);
      if (cost === null || cost > constraints.maxCostUsd) {
        reject("cost_unverified_or_over_budget"); continue;
      }
    }
    const quality = model.qualityScores?.[task];
    if (Object.hasOwn(requirements, "minQualityScore") &&
        (!finiteNumber(quality) || quality < requirements.minQualityScore)) {
      reject("quality_floor_unverified_or_not_met"); continue;
    }

    const scored = scoreCandidate(model, task, requirements.inputTokens, requirements.outputTokens);
    eligible.push({ model, ...scored });
  }

  eligible.sort((a, b) =>
    b.score - a.score ||
    (a.estimatedCostUsd ?? Number.POSITIVE_INFINITY) - (b.estimatedCostUsd ?? Number.POSITIVE_INFINITY) ||
    (a.model.p95LatencyMs ?? Number.POSITIVE_INFINITY) - (b.model.p95LatencyMs ?? Number.POSITIVE_INFINITY) ||
    a.model.id.localeCompare(b.model.id)
  );

  return { eligible, rejected, policyVersion: MODEL_ROUTING_POLICY_VERSION };
}

export function selectModel(options = {}) {
  const evaluated = evaluateModelCandidates(options);
  if (!evaluated.eligible.length) throw new NoEligibleModelError(options.task, evaluated.rejected);
  const selected = evaluated.eligible[0];
  return {
    model: selected.model,
    policyVersion: evaluated.policyVersion,
    score: selected.score,
    evidence: selected.evidence,
    rejectedCandidates: evaluated.rejected
  };
}
