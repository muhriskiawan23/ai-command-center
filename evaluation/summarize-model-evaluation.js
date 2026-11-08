import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXECUTION_TYPES = new Set(["manual_live", "manual_mocked"]);
const RUN_STATUSES = new Set(["pending", "completed", "failed", "skipped"]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function validateRun(run, scoreDimensions, index) {
  const label = `runs[${index}]`;
  if (!run || typeof run !== "object" || Array.isArray(run)) {
    throw new TypeError(`${label} must be an object`);
  }
  for (const key of ["caseId", "modelId", "language", "task"]) {
    if (!isNonEmptyString(run[key])) throw new TypeError(`${label}.${key} must be a non-empty string`);
  }
  if (!Number.isSafeInteger(run.runIndex) || run.runIndex < 1) {
    throw new TypeError(`${label}.runIndex must be a positive safe integer`);
  }
  if (!RUN_STATUSES.has(run.status)) throw new TypeError(`${label}.status is invalid`);
  if (!run.scores || typeof run.scores !== "object" || Array.isArray(run.scores)) {
    throw new TypeError(`${label}.scores must be an object`);
  }
  for (const dimension of scoreDimensions) {
    const score = run.scores[dimension];
    if (score !== null && (!Number.isInteger(score) || score < 1 || score > 5)) {
      throw new TypeError(`${label}.scores.${dimension} must be null or an integer from 1 to 5`);
    }
    if (run.status === "completed" && score === null) {
      throw new TypeError(`${label}.scores.${dimension} is required for completed runs`);
    }
  }
  if (run.criticalSafetyFailure !== null && typeof run.criticalSafetyFailure !== "boolean") {
    throw new TypeError(`${label}.criticalSafetyFailure must be boolean or null`);
  }
  for (const key of ["latencyMs", "costUsd"]) {
    if (run[key] !== null && (!Number.isFinite(run[key]) || run[key] < 0)) {
      throw new TypeError(`${label}.${key} must be null or a non-negative finite number`);
    }
  }
  for (const key of ["inputTokens", "outputTokens"]) {
    if (run[key] !== null && (!Number.isSafeInteger(run[key]) || run[key] < 0)) {
      throw new TypeError(`${label}.${key} must be null or a non-negative safe integer`);
    }
  }
  if (run.status === "completed") {
    for (const key of ["actualModelId", "actualModelVersion", "provider", "policyVersion"]) {
      if (!isNonEmptyString(run[key])) throw new TypeError(`${label}.${key} is required for completed runs`);
    }
    if (!EXECUTION_TYPES.has(run.executionType)) {
      throw new TypeError(`${label}.executionType must be manual_live or manual_mocked`);
    }
    if (!validTimestamp(run.startedAt) || !validTimestamp(run.completedAt) ||
        Date.parse(run.completedAt) < Date.parse(run.startedAt)) {
      throw new TypeError(`${label} must have valid startedAt/completedAt timestamps in chronological order`);
    }
    if (typeof run.criticalSafetyFailure !== "boolean") {
      throw new TypeError(`${label}.criticalSafetyFailure is required for completed runs`);
    }
  }
  if (run.status === "failed" && !isNonEmptyString(run.failureReason)) {
    throw new TypeError(`${label}.failureReason is required for failed runs`);
  }
}

function summarizeGroup(runs, scoreDimensions) {
  const completed = runs.filter((run) => run.status === "completed");
  const scores = Object.fromEntries(scoreDimensions.map((dimension) => {
    const values = completed.map((run) => run.scores[dimension]);
    return [dimension, { mean: mean(values), median: median(values), count: values.length }];
  }));
  const overallScores = completed.map((run) =>
    mean(scoreDimensions.map((dimension) => run.scores[dimension]))
  );
  const latencies = completed.map((run) => run.latencyMs).filter((value) => value !== null);
  const costs = runs.map((run) => run.costUsd).filter((value) => value !== null);
  const successful = completed.filter((run) => run.criticalSafetyFailure === false).length;
  const totalCostUsd = costs.length ? costs.reduce((sum, value) => sum + value, 0) : null;
  return {
    planned: runs.length,
    completed: completed.length,
    failed: runs.filter((run) => run.status === "failed").length,
    skipped: runs.filter((run) => run.status === "skipped").length,
    pending: runs.filter((run) => run.status === "pending").length,
    criticalSafetyFailures: completed.filter((run) => run.criticalSafetyFailure).length,
    overallScore: { mean: mean(overallScores), median: median(overallScores), count: overallScores.length },
    scores,
    latencyMs: { mean: mean(latencies), median: median(latencies), count: latencies.length },
    totalCostUsd,
    costPerSafetyCleanCompletedRunUsd: successful && totalCostUsd !== null ? totalCostUsd / successful : null,
    evidenceTypes: [...new Set(completed.map((run) => run.executionType))].sort(),
    actualModelIds: [...new Set(completed.map((run) => run.actualModelId))].sort(),
    actualModelVersions: [...new Set(completed.map((run) => run.actualModelVersion))].sort()
  };
}

function groupBy(runs, key) {
  const groups = new Map();
  for (const run of runs) {
    const value = run[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(run);
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function summarizeEvaluationResults(plan) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.runs) ||
      !Array.isArray(plan.scoreDimensions) || plan.scoreDimensions.length === 0) {
    throw new TypeError("plan must contain runs and scoreDimensions");
  }
  if (new Set(plan.scoreDimensions).size !== plan.scoreDimensions.length ||
      plan.scoreDimensions.some((value) => !isNonEmptyString(value))) {
    throw new TypeError("scoreDimensions must contain unique non-empty strings");
  }
  const keys = new Set();
  plan.runs.forEach((run, index) => {
    validateRun(run, plan.scoreDimensions, index);
    const key = `${run.modelId}|${run.caseId}|${run.runIndex}`;
    if (keys.has(key)) throw new TypeError(`duplicate evaluation run: ${key}`);
    keys.add(key);
  });
  const runs = plan.runs;
  const summarizeGroups = (key) => Object.fromEntries(
    Object.entries(groupBy(runs, key)).map(([name, items]) => [
      name,
      summarizeGroup(items, plan.scoreDimensions)
    ])
  );
  return {
    reportVersion: "1.0.0",
    benchmarkVersion: plan.benchmarkVersion || "unknown",
    planVersion: plan.planVersion || "unknown",
    totals: summarizeGroup(runs, plan.scoreDimensions),
    byModel: summarizeGroups("modelId"),
    byLanguage: summarizeGroups("language"),
    byTask: summarizeGroups("task"),
    limitations: [
      "Only completed runs with valid scores contribute to quality aggregates.",
      "Unknown latency, token usage, or cost remains null and is never treated as zero.",
      "Mocked and live evidence types are reported separately and must not be conflated.",
      "A critical safety failure is reported separately and is not hidden by average scores."
    ]
  };
}

async function main(args) {
  const inputPath = args[0];
  if (!inputPath || args.length !== 1) {
    throw new TypeError("Usage: npm run eval:report -- path/to/completed-evaluation-plan.json");
  }
  const plan = JSON.parse(await readFile(inputPath, "utf8"));
  const report = summarizeEvaluationResults(plan);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Evaluation report failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
