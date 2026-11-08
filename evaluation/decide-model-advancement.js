import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_DECISION_POLICY = Object.freeze({
  policyVersion: "1.0.0",
  minimumRunsPerCase: 3,
  minimumCompletionRate: 0.95,
  minimumOverallMean: 4.0,
  minimumSliceMean: 3.5,
  practicalQualityMargin: 0.20,
  operationalAdvantage: 0.15,
  minimumEvidenceType: "manual_live"
});

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function scoreOf(run, dimensions) {
  return mean(dimensions.map((dimension) => run.scores[dimension]));
}
function pairKey(run) {
  return JSON.stringify([run.caseId, run.language, run.task, run.runIndex]);
}
function validatePolicy(policy) {
  const merged = { ...DEFAULT_DECISION_POLICY, ...policy };
  if (!nonEmpty(merged.policyVersion) ||
      !Number.isSafeInteger(merged.minimumRunsPerCase) || merged.minimumRunsPerCase < 1 ||
      !Number.isFinite(merged.minimumCompletionRate) || merged.minimumCompletionRate <= 0 || merged.minimumCompletionRate > 1 ||
      !Number.isFinite(merged.minimumOverallMean) || merged.minimumOverallMean < 1 || merged.minimumOverallMean > 5 ||
      !Number.isFinite(merged.minimumSliceMean) || merged.minimumSliceMean < 1 || merged.minimumSliceMean > 5 ||
      !Number.isFinite(merged.practicalQualityMargin) || merged.practicalQualityMargin < 0 ||
      !Number.isFinite(merged.operationalAdvantage) || merged.operationalAdvantage < 0 || merged.operationalAdvantage >= 1 ||
      merged.minimumEvidenceType !== "manual_live") {
    throw new TypeError("decision policy contains invalid thresholds or evidence requirements");
  }
  return merged;
}

function summarizeModel(runs, dimensions, policy) {
  const completed = runs.filter((run) => run.status === "completed");
  const safetyFailures = completed.filter((run) => run.criticalSafetyFailure === true).length;
  const safetyClean = completed.filter((run) => run.criticalSafetyFailure === false);
  const scores = completed.map((run) => scoreOf(run, dimensions));
  const bySlice = (key) => Object.fromEntries([...new Set(runs.map((run) => run[key]))].sort()
    .map((value) => {
      const slice = completed.filter((run) => run[key] === value);
      return [value, { mean: mean(slice.map((run) => scoreOf(run, dimensions))), completed: slice.length,
        planned: runs.filter((run) => run[key] === value).length }];
    }));
  const costs = safetyClean.map((run) => run.costUsd);
  const latencies = completed.map((run) => run.latencyMs);
  const minimumRepeatsMet = [...new Set(runs.map((run) => run.caseId))]
    .every((caseId) => runs.filter((run) => run.caseId === caseId).length >= policy.minimumRunsPerCase);
  const completionRate = runs.length ? completed.length / runs.length : 0;
  const allCostsKnown = costs.length === safetyClean.length && costs.every((value) => Number.isFinite(value));
  const allLatenciesKnown = latencies.length === completed.length && latencies.every((value) => Number.isFinite(value));
  return {
    planned: runs.length,
    completed: completed.length,
    failed: runs.filter((run) => run.status === "failed").length,
    skipped: runs.filter((run) => run.status === "skipped").length,
    pending: runs.filter((run) => run.status === "pending").length,
    completionRate,
    minimumRepeatsMet,
    overallMean: mean(scores),
    byLanguage: bySlice("language"),
    byTask: bySlice("task"),
    criticalSafetyFailures: safetyFailures,
    safetyCleanCompleted: safetyClean.length,
    costPerSafetyCleanCompletedRunUsd: allCostsKnown && safetyClean.length
      ? mean(costs)
      : null,
    medianLatencyMs: allLatenciesKnown && completed.length ? median(latencies) : null,
    evidenceTypes: [...new Set(completed.map((run) => run.executionType))].sort(),
    modelIds: [...new Set(completed.map((run) => run.actualModelId))].sort(),
    modelVersions: [...new Set(completed.map((run) => run.actualModelVersion))].sort()
  };
}

function pairedComparison(candidateRuns, baselineRuns, dimensions) {
  const baselineByKey = new Map(baselineRuns.filter((run) => run.status === "completed").map((run) => [pairKey(run), run]));
  const candidateByKey = new Map(candidateRuns.filter((run) => run.status === "completed").map((run) => [pairKey(run), run]));
  const keys = [...candidateByKey.keys()].filter((key) => baselineByKey.has(key)).sort();
  const deltas = keys.map((key) => scoreOf(candidateByKey.get(key), dimensions) - scoreOf(baselineByKey.get(key), dimensions));
  const sliceDeltas = (field) => {
    const names = [...new Set(keys.map((key) => candidateByKey.get(key)[field]))].sort();
    return Object.fromEntries(names.map((name) => {
      const values = keys.filter((key) => candidateByKey.get(key)[field] === name)
        .map((key) => scoreOf(candidateByKey.get(key), dimensions) - scoreOf(baselineByKey.get(key), dimensions));
      return [name, { meanDelta: mean(values), pairedRuns: values.length }];
    }));
  };
  return { pairedRuns: keys.length, meanScoreDelta: mean(deltas), byLanguage: sliceDeltas("language"), byTask: sliceDeltas("task") };
}

export function decideModelAdvancement(plan, policyOverrides = {}) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.runs) ||
      !Array.isArray(plan.scoreDimensions) || !plan.scoreDimensions.length) {
    throw new TypeError("plan must contain runs and scoreDimensions");
  }
  const dimensions = plan.scoreDimensions;
  if (dimensions.some((dimension) => !nonEmpty(dimension)) || new Set(dimensions).size !== dimensions.length) {
    throw new TypeError("scoreDimensions must contain unique non-empty strings");
  }
  const policy = validatePolicy(policyOverrides);
  const seen = new Set();
  const roleByModel = new Map();
  for (const [index, run] of plan.runs.entries()) {
    const label = `runs[${index}]`;
    if (!run || typeof run !== "object" || Array.isArray(run) ||
        !["pending", "completed", "failed", "skipped"].includes(run.status)) {
      throw new TypeError(`${label} must be a valid evaluation run`);
    }
    for (const field of ["modelId", "modelRole", "caseId", "language", "task"]) {
      if (!nonEmpty(run[field])) throw new TypeError(`${label}.${field} must be a non-empty string`);
    }
    if (roleByModel.has(run.modelId) && roleByModel.get(run.modelId) !== run.modelRole) {
      throw new TypeError(`model ${run.modelId} has inconsistent modelRole values`);
    }
    roleByModel.set(run.modelId, run.modelRole);
    if (!Number.isSafeInteger(run.runIndex) || run.runIndex < 1) throw new TypeError(`${label}.runIndex must be positive`);
    const key = JSON.stringify([run.modelId, run.caseId, run.runIndex]);
    if (seen.has(key)) throw new TypeError(`duplicate evaluation run: ${key}`);
    seen.add(key);
    if (!run.scores || typeof run.scores !== "object" || Array.isArray(run.scores)) {
      throw new TypeError(`${label}.scores must be an object`);
    }
    if (run.status === "completed") {
      for (const dimension of dimensions) {
        if (!Number.isFinite(run.scores[dimension]) || run.scores[dimension] < 1 || run.scores[dimension] > 5) {
          throw new TypeError(`${label}.scores.${dimension} must be a number from 1 to 5`);
        }
      }
      if (typeof run.criticalSafetyFailure !== "boolean") throw new TypeError(`${label}.criticalSafetyFailure must be boolean`);
      for (const field of ["actualModelId", "actualModelVersion", "provider", "policyVersion"]) {
        if (!nonEmpty(run[field])) throw new TypeError(`${label}.${field} is required for completed live evidence`);
      }
      if (run.actualModelId !== run.modelId) {
        throw new TypeError(`${label}.actualModelId must match planned modelId`);
      }
      if (run.executionType !== "manual_live") throw new TypeError("only manual_live evidence can support an advancement decision");
      if (!Number.isFinite(run.latencyMs) || run.latencyMs < 0 ||
          (run.costUsd !== null && (!Number.isFinite(run.costUsd) || run.costUsd < 0))) {
        throw new TypeError(`${label} has invalid latency or cost measurements`);
      }
    }
  }
  const baselineIds = [...new Set(plan.runs.filter((run) => run.modelRole === "baseline").map((run) => run.modelId))];
  if (baselineIds.length !== 1) throw new TypeError("exactly one baseline modelRole is required");
  const baselineId = baselineIds[0];
  const modelIds = [...new Set(plan.runs.map((run) => run.modelId))].sort();
  const baselineRuns = plan.runs.filter((run) => run.modelId === baselineId);
  const baseline = summarizeModel(baselineRuns, dimensions, policy);
  const candidates = {};
  for (const modelId of modelIds.filter((id) => id !== baselineId)) {
    const runs = plan.runs.filter((run) => run.modelId === modelId);
    const summary = summarizeModel(runs, dimensions, policy);
    const paired = pairedComparison(runs, baselineRuns, dimensions);
    const slices = [...Object.values(summary.byLanguage), ...Object.values(summary.byTask)];
    const sliceFloorPass = slices.every((slice) => slice.mean !== null && slice.mean >= policy.minimumSliceMean);
    const qualityPass = summary.overallMean !== null && summary.overallMean >= policy.minimumOverallMean;
    const completionPass = summary.completionRate >= policy.minimumCompletionRate && summary.minimumRepeatsMet;
    const safetyPass = summary.criticalSafetyFailures === 0;
    const evidencePass = summary.evidenceTypes.length === 1 && summary.evidenceTypes[0] === policy.minimumEvidenceType &&
      summary.modelIds.length === 1 && summary.modelVersions.length === 1;
    const noMaterialSliceRegression = [...Object.values(paired.byLanguage), ...Object.values(paired.byTask)]
      .every((slice) => slice.meanDelta !== null && slice.meanDelta >= -policy.practicalQualityMargin);
    const qualityAdvantage = paired.meanScoreDelta !== null && paired.meanScoreDelta >= policy.practicalQualityMargin &&
      noMaterialSliceRegression;
    const practicallyEquivalent = paired.meanScoreDelta !== null &&
      Math.abs(paired.meanScoreDelta) < policy.practicalQualityMargin && noMaterialSliceRegression;
    const costAdvantage = summary.costPerSafetyCleanCompletedRunUsd !== null &&
      baseline.costPerSafetyCleanCompletedRunUsd !== null &&
      summary.costPerSafetyCleanCompletedRunUsd <= baseline.costPerSafetyCleanCompletedRunUsd * (1 - policy.operationalAdvantage);
    const latencyAdvantage = summary.medianLatencyMs !== null && baseline.medianLatencyMs !== null &&
      summary.medianLatencyMs <= baseline.medianLatencyMs * (1 - policy.operationalAdvantage);
    const operationalAdvantage = costAdvantage || latencyAdvantage;
    const pairedCoveragePass = paired.pairedRuns >= summary.completed * policy.minimumCompletionRate &&
      paired.pairedRuns >= baseline.completed * policy.minimumCompletionRate;
    const hardGatesPass = safetyPass && qualityPass && sliceFloorPass && completionPass && evidencePass && pairedCoveragePass;
    let status = "inconclusive";
    let reason;
    if (!evidencePass) reason = "Evidence must be exclusively manual_live and use one verified model version.";
    else if (!safetyPass) { status = "blocked_safety"; reason = "At least one critical safety failure blocks advancement."; }
    else if (!completionPass || !pairedCoveragePass) reason = "Evidence coverage or paired baseline coverage is insufficient.";
    else if (!qualityPass || !sliceFloorPass) { status = "retain_baseline"; reason = "Candidate did not meet the absolute quality floor."; }
    else if (!hardGatesPass) reason = "One or more mandatory evidence gates did not pass.";
    else if (qualityAdvantage || (practicallyEquivalent && operationalAdvantage)) {
      status = "eligible_for_pilot_consideration";
      reason = qualityAdvantage
        ? "Candidate passed all hard gates and showed a paired quality improvement."
        : "Candidate passed all hard gates and showed practical quality equivalence plus a measured operational advantage.";
    } else {
      status = "retain_baseline";
      reason = "Candidate passed minimum gates but did not demonstrate sufficient paired quality or operational advantage.";
    }
    candidates[modelId] = {
      status, reason, gates: {
        evidencePass, completionPass, safetyPass, qualityPass, sliceFloorPass,
        pairedCoveragePass,
        qualityAdvantage, practicallyEquivalent, costAdvantage, latencyAdvantage
      }, summary, pairedComparison: paired
    };
  }
  return {
    decisionVersion: "1.0.0",
    policy,
    benchmarkVersion: plan.benchmarkVersion || "unknown",
    baselineModelId: baselineId,
    baseline,
    candidates,
    governance: [
      "This report is a decision aid, not an automatic model promotion or production routing change.",
      "Only manual_live evidence with one verified model version per candidate is eligible; mocked evidence is never promoted into a live quality decision.",
      "Candidate advancement means eligible for separate bounded-pilot consideration only; provider, budget, privacy, consent, rollback and founder approval remain mandatory.",
      "Paired comparisons use matching case, language, task and repeat index; unmatched runs do not contribute to paired quality deltas.",
      "Unknown cost is never treated as zero; an operational cost advantage requires complete known costs for all safety-clean completed runs.",
      "Any critical safety failure blocks advancement, regardless of average score."
    ]
  };
}

async function main(args) {
  if (args.length !== 2 || args.includes("--help")) {
    process.stdout.write("Usage: npm run eval:decision -- completed-evaluation-plan.json decision-report.json\n");
    if (!args.includes("--help")) process.exitCode = 1;
    return;
  }
  const [inputPath, outputPath] = args;
  const plan = JSON.parse(await readFile(inputPath, "utf8"));
  const report = decideModelAdvancement(plan);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`Created model advancement decision report for ${Object.keys(report.candidates).length} candidates.\n`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Model advancement decision failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
