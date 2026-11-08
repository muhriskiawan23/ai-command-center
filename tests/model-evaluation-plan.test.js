import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEvaluationPlan, EVALUATION_CANDIDATES } from "../evaluation/prepare-model-evaluation.js";

const benchmarkUrl = new URL("../evaluation/model-quality-cases.json", import.meta.url);

test("creates a complete manual-only bilingual evaluation plan", async () => {
  const benchmark = JSON.parse(await readFile(benchmarkUrl, "utf8"));
  const plan = createEvaluationPlan({ benchmark });

  assert.equal(plan.executionMode, "manual");
  assert.equal(plan.liveInferenceEnabled, false);
  assert.equal(plan.providerCallsMade, 0);
  assert.equal(plan.caseCount, 20);
  assert.equal(plan.modelCount, 5);
  assert.equal(plan.runsPerCase, 3);
  assert.equal(plan.plannedRunCount, 20 * 5 * 3);
  assert.equal(plan.runs.length, plan.plannedRunCount);

  const baselineRuns = plan.runs.filter((run) => run.modelRole === "baseline");
  const candidateRuns = plan.runs.filter((run) => run.modelRole === "candidate");
  assert.equal(baselineRuns.length, 20 * 3);
  assert.equal(candidateRuns.length, 4 * 20 * 3);
  assert.ok(candidateRuns.every((run) => ["general_reasoning_tool_use", "efficiency", "indonesian_quality", "reasoning_coding"].includes(run.candidateProfile)));
  assert.ok(plan.runs.every((run) => run.status === "pending"));
  assert.ok(plan.runs.every((run) => run.criticalSafetyFailure === null));
  assert.ok(plan.runs.every((run) => Object.values(run.scores).every((score) => score === null)));
});

test("includes every benchmark case for every candidate and repeat", async () => {
  const benchmark = JSON.parse(await readFile(benchmarkUrl, "utf8"));
  const plan = createEvaluationPlan({ benchmark });
  const expected = new Set(
    EVALUATION_CANDIDATES.flatMap((model) =>
      benchmark.cases.flatMap((item) =>
        [1, 2, 3].map((runIndex) => `${model.id}|${item.id}|${runIndex}`)
      )
    )
  );
  const actual = new Set(plan.runs.map((run) => `${run.modelId}|${run.caseId}|${run.runIndex}`));
  assert.deepEqual(actual, expected);
});

test("requires at least the benchmark's minimum independent runs", async () => {
  const benchmark = JSON.parse(await readFile(benchmarkUrl, "utf8"));
  assert.throws(() => createEvaluationPlan({ benchmark, runsPerCase: 2 }), /at least 3/);
});

test("rejects duplicate model IDs and incomplete benchmark cases", async () => {
  const benchmark = JSON.parse(await readFile(benchmarkUrl, "utf8"));
  assert.throws(() => createEvaluationPlan({
    benchmark,
    models: [{ id: "same" }, { id: "same" }]
  }), /unique/);

  const invalid = { ...benchmark, cases: [{ ...benchmark.cases[0], prompt: "" }] };
  assert.throws(() => createEvaluationPlan({ benchmark: invalid }), /incomplete/);
});
