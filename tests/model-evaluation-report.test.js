import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEvaluationPlan } from "../evaluation/prepare-model-evaluation.js";
import { summarizeEvaluationResults } from "../evaluation/summarize-model-evaluation.js";

const benchmarkUrl = new URL("../evaluation/model-quality-cases.json", import.meta.url);

async function createPlan() {
  const benchmark = JSON.parse(await readFile(benchmarkUrl, "utf8"));
  return createEvaluationPlan({ benchmark });
}

function completeRun(run, overrides = {}) {
  return {
    ...run,
    status: "completed",
    actualModelId: run.modelId,
    actualModelVersion: "verified-version-1",
    provider: "cloudflare-workers-ai",
    policyVersion: "adaptive-v1",
    executionType: "manual_mocked",
    startedAt: "2026-11-08T10:00:00.000Z",
    completedAt: "2026-11-08T10:00:01.250Z",
    latencyMs: 1250,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.002,
    criticalSafetyFailure: false,
    scores: Object.fromEntries(Object.keys(run.scores).map((key) => [key, 4])),
    ...overrides
  };
}

test("summarizes pending plans without treating missing measurements as zero", async () => {
  const plan = await createPlan();
  const report = summarizeEvaluationResults(plan);
  assert.equal(report.totals.planned, 300);
  assert.equal(report.totals.pending, 300);
  assert.equal(report.totals.completed, 0);
  assert.equal(report.totals.overallScore.mean, null);
  assert.equal(report.totals.latencyMs.mean, null);
  assert.equal(report.totals.totalCostUsd, null);
  assert.equal(report.byModel["@cf/meta/llama-3.3-70b-instruct-fp8-fast"].pending, 60);
});

test("aggregates completed evidence, scores, latency, and cost by model/language/task", async () => {
  const plan = await createPlan();
  plan.runs[0] = completeRun(plan.runs[0]);
  plan.runs[1] = completeRun(plan.runs[1], {
    scores: Object.fromEntries(Object.keys(plan.runs[1].scores).map((key) => [key, 2])),
    latencyMs: 750,
    costUsd: 0.004,
    criticalSafetyFailure: true
  });
  const report = summarizeEvaluationResults(plan);
  assert.equal(report.totals.completed, 2);
  assert.equal(report.totals.pending, 298);
  assert.equal(report.totals.criticalSafetyFailures, 1);
  assert.equal(report.totals.overallScore.mean, 3);
  assert.equal(report.totals.latencyMs.mean, 1000);
  assert.equal(report.totals.totalCostUsd, 0.006);
  assert.equal(report.totals.costPerSafetyCleanCompletedRunUsd, 0.006);
  assert.equal(report.byLanguage.id.completed, 2);
  assert.equal(report.byTask.fast_chat.completed, 2);
  assert.deepEqual(report.totals.evidenceTypes, ["manual_mocked"]);
});

test("rejects completed runs without actual model identity or complete scores", async () => {
  const plan = await createPlan();
  plan.runs[0] = completeRun(plan.runs[0], { actualModelVersion: null });
  assert.throws(() => summarizeEvaluationResults(plan), /actualModelVersion/);

  plan.runs[0] = completeRun(plan.runs[0], {
    scores: { ...plan.runs[0].scores, correctness: null }
  });
  assert.throws(() => summarizeEvaluationResults(plan), /correctness is required/);
});

test("rejects invalid measurements, timestamps, duplicate runs, and failed runs without a reason", async () => {
  const plan = await createPlan();
  plan.runs[0] = completeRun(plan.runs[0], { latencyMs: -1 });
  assert.throws(() => summarizeEvaluationResults(plan), /latencyMs/);

  plan.runs[0] = completeRun(plan.runs[0], { completedAt: "not-a-date" });
  assert.throws(() => summarizeEvaluationResults(plan), /timestamps/);

  plan.runs[0] = { ...plan.runs[0], status: "failed", failureReason: "" };
  assert.throws(() => summarizeEvaluationResults(plan), /failureReason/);

  plan.runs[0] = { ...plan.runs[1] };
  assert.throws(() => summarizeEvaluationResults(plan), /duplicate evaluation run/);
});
