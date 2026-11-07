export const MODEL_ROUTING_POLICY_VERSION = "adaptive-v1";
export const DEFAULT_MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export const TASK_PROFILES = Object.freeze({
  fast_chat: Object.freeze({ requiredCapabilities: ["text"] }),
  deep_reasoning: Object.freeze({ requiredCapabilities: ["text"] }),
  research_synthesis: Object.freeze({ requiredCapabilities: ["text"] }),
  coding: Object.freeze({ requiredCapabilities: ["text"] }),
  translation: Object.freeze({ requiredCapabilities: ["text"] }),
  multimodal_vision: Object.freeze({ requiredCapabilities: ["text", "vision"] }),
  audio: Object.freeze({ requiredCapabilities: ["audio"] }),
  structured_extraction: Object.freeze({ requiredCapabilities: ["text", "structured-output"] })
});

// This is an audited baseline, not a claim that the model's unverified limits or
// benchmark scores are known. Add candidates only with verified metadata.
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

function estimateCostUsd(model, inputTokens, outputTokens) {
  if (!finiteNumber(model.inputCostPerMillionUsd) || !finiteNumber(model.outputCostPerMillionUsd)) return null;
  return (inputTokens * model.inputCostPerMillionUsd + outputTokens * model.outputCostPerMillionUsd) / 1_000_000;
}

function scoreCandidate(model, task, inputTokens = 1000, outputTokens = 1000) {
  const quality = model.qualityScores?.[task];
  const reliability = model.reliability;
  const latency = model.p95LatencyMs;
  // Unknown measurements receive a neutral score, but are explicitly surfaced
  // in evidence so an unbenchmarked model cannot be presented as proven.
  const qualityScore = finiteNumber(quality) ? Math.max(0, Math.min(1, quality)) : 0.5;
  const reliabilityScore = finiteNumber(reliability) ? Math.max(0, Math.min(1, reliability)) : 0.5;
  const latencyScore = finiteNumber(latency) && latency >= 0 ? 1 / (1 + latency / 1000) : 0.5;
  const estimatedCost = estimateCostUsd(model, inputTokens, outputTokens);
  const costScore = estimatedCost !== null && estimatedCost >= 0 ? 1 / (1 + estimatedCost * 1000) : 0.5;
  return {
    score: qualityScore * 0.6 + reliabilityScore * 0.2 + latencyScore * 0.1 + costScore * 0.1,
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

    if (finiteNumber(requirements.inputTokens)) {
      if (!finiteNumber(model.contextWindowTokens) || requirements.inputTokens > model.contextWindowTokens) {
        reject("context_limit_unverified_or_exceeded"); continue;
      }
    }
    if (constraints.region) {
      if (!Array.isArray(model.regions) || !(model.regions.includes(constraints.region) || model.regions.includes("global"))) {
        reject("region_unverified_or_unsupported"); continue;
      }
    }
    if (model.external && !(constraints.allowExternalProviders === true && constraints.userConsent === true)) {
      reject("external_provider_not_approved"); continue;
    }
    if (constraints.dataPolicy) {
      if (!Array.isArray(model.dataPolicies) || !model.dataPolicies.includes(constraints.dataPolicy)) {
        reject("data_policy_unverified_or_incompatible"); continue;
      }
    }
    if (finiteNumber(constraints.deadlineMs) && finiteNumber(model.p95LatencyMs) && model.p95LatencyMs > constraints.deadlineMs) {
      reject("deadline_not_feasible"); continue;
    }
    if (finiteNumber(constraints.maxCostUsd)) {
      const cost = estimateCostUsd(model, requirements.inputTokens || 0, requirements.outputTokens || 0);
      if (cost === null || cost > constraints.maxCostUsd) {
        reject("cost_unverified_or_over_budget"); continue;
      }
    }
    const quality = model.qualityScores?.[task];
    if (finiteNumber(requirements.minQualityScore) && (!finiteNumber(quality) || quality < requirements.minQualityScore)) {
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
  if (!evaluated.eligible.length) {
    throw new NoEligibleModelError(options.task, evaluated.rejected);
  }
  const selected = evaluated.eligible[0];
  return {
    model: selected.model,
    policyVersion: evaluated.policyVersion,
    score: selected.score,
    evidence: selected.evidence,
    rejectedCandidates: evaluated.rejected
  };
}
