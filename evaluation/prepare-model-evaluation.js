import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export const EVALUATION_CANDIDATES = Object.freeze([
  Object.freeze({ id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", role: "baseline" }),
  Object.freeze({ id: "@cf/zai-org/glm-4.7-flash", role: "candidate", profile: "general_reasoning_tool_use" }),
  Object.freeze({ id: "@cf/ibm-granite/granite-4.0-h-micro", role: "candidate", profile: "efficiency" }),
  Object.freeze({ id: "@cf/aisingapore/gemma-sea-lion-v4-27b-it", role: "candidate", profile: "indonesian_quality" }),
  Object.freeze({ id: "@cf/openai/gpt-oss-20b", role: "candidate", profile: "reasoning_coding" })
]);

const SCORE_DIMENSIONS = Object.freeze([
  "correctness",
  "taskCompletion",
  "reasoningAndEvidence",
  "languageFluency",
  "safetyAndUncertainty",
  "formattingAndCode"
]);

export function createEvaluationPlan({
  benchmark,
  models = EVALUATION_CANDIDATES,
  runsPerCase = benchmark?.minimumRunsPerCase
} = {}) {
  if (!benchmark || !Array.isArray(benchmark.cases) || benchmark.cases.length === 0) {
    throw new TypeError("benchmark must contain at least one case");
  }
  if (!Number.isSafeInteger(benchmark.minimumRunsPerCase) || benchmark.minimumRunsPerCase < 1) {
    throw new TypeError("benchmark.minimumRunsPerCase must be a positive safe integer");
  }
  if (!Number.isSafeInteger(runsPerCase) || runsPerCase < benchmark.minimumRunsPerCase) {
    throw new RangeError(`runsPerCase must be at least ${benchmark.minimumRunsPerCase}`);
  }
  if (!Array.isArray(models) || models.length === 0 ||
      models.some((model) => !model || typeof model.id !== "string" || !model.id.trim())) {
    throw new TypeError("models must be a non-empty array of models with IDs");
  }
  const modelIds = models.map((model) => model.id);
  if (new Set(modelIds).size !== modelIds.length) {
    throw new TypeError("model IDs must be unique");
  }
  const caseIds = benchmark.cases.map((item) => item?.id);
  if (caseIds.some((id) => typeof id !== "string" || !id.trim()) ||
      new Set(caseIds).size !== caseIds.length) {
    throw new TypeError("benchmark case IDs must be non-empty and unique");
  }
  for (const item of benchmark.cases) {
    if (!["id", "en"].includes(item.language) || typeof item.task !== "string" ||
        typeof item.prompt !== "string" || !item.prompt.trim() || !Array.isArray(item.criteria) || item.criteria.length === 0 ||
        item.criteria.some((criterion) => typeof criterion !== "string" || !criterion.trim())) {
      throw new TypeError(`benchmark case ${item.id} is incomplete`);
    }
  }

  const runs = [];
  for (const model of models) {
    for (const item of benchmark.cases) {
      for (let runIndex = 1; runIndex <= runsPerCase; runIndex += 1) {
        runs.push({
          caseId: item.id,
          language: item.language,
          task: item.task,
          modelId: model.id,
          modelRole: model.role || "candidate",
          candidateProfile: model.profile || null,
          runIndex,
          prompt: item.prompt,
          acceptanceCriteria: [...item.criteria],
          status: "pending",
          scores: Object.fromEntries(SCORE_DIMENSIONS.map((dimension) => [dimension, null])),
          criticalSafetyFailure: null,
          actualModelId: null,
          actualModelVersion: null,
          provider: null,
          policyVersion: null,
          executionType: null,
          startedAt: null,
          completedAt: null,
          latencyMs: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          failureReason: "",
          modelOutput: null,
          reviewerNotes: ""
        });
      }
    }
  }

  return {
    planVersion: "1.0.0",
    benchmarkVersion: benchmark.version || "unknown",
    executionMode: "manual",
    liveInferenceEnabled: false,
    providerCallsMade: 0,
    minimumRunsPerCase: benchmark.minimumRunsPerCase,
    runsPerCase,
    modelCount: models.length,
    caseCount: benchmark.cases.length,
    plannedRunCount: runs.length,
    scoreScale: { min: 1, max: 5 },
    scoreDimensions: [...SCORE_DIMENSIONS],
    instructions: [
      "This command only prepares a review plan; it never calls a model or provider.",
      "Run each prompt manually in an approved environment and record the returned model/version.",
      "Keep model identity hidden from reviewers until scoring is complete.",
      "Mark every score from 1 to 5; record critical safety failures separately.",
      "Do not promote scores into the production routing catalog without review and founder approval."
    ],
    runs
  };
}

async function main(args) {
  const benchmarkPath = new URL("./model-quality-cases.json", import.meta.url);
  const benchmark = JSON.parse(await readFile(benchmarkPath, "utf8"));
  let runsPerCase = benchmark.minimumRunsPerCase;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--help") {
      process.stdout.write("Usage: node evaluation/prepare-model-evaluation.js [--runs N]\n");
      return;
    }
    if (args[index] === "--runs") {
      const value = Number(args[index + 1]);
      if (!Number.isSafeInteger(value)) throw new TypeError("--runs requires a positive integer");
      runsPerCase = value;
      index += 1;
    } else {
      throw new TypeError(`Unknown argument: ${args[index]}`);
    }
  }
  const plan = createEvaluationPlan({ benchmark, runsPerCase });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Evaluation plan failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
