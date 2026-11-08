import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEvaluationPlan } from "../evaluation/prepare-model-evaluation.js";
import { createBlindedReviewPackets } from "../evaluation/create-blinded-review-packets.js";

const benchmarkUrl = new URL("../evaluation/model-quality-cases.json", import.meta.url);
async function samplePlan() {
  const benchmark = JSON.parse(await readFile(benchmarkUrl, "utf8"));
  const plan = createEvaluationPlan({ benchmark, models: [
    { id: "baseline-model", role: "baseline" }, { id: "candidate-model", role: "candidate" }
  ] });
  plan.runs = plan.runs.map((run) => ({ ...run, modelOutput: `Answer for ${run.caseId} / ${run.modelId} / ${run.runIndex}` }));
  return plan;
}

test("creates anonymous review packet and separate identity key", async () => {
  const plan = await samplePlan();
  const { reviewerPacket, identityKey } = createBlindedReviewPackets(plan, { packetId: "test-packet", random: () => 0.37 });
  assert.equal(reviewerPacket.items.length, plan.runs.length);
  assert.equal(identityKey.packetId, reviewerPacket.packetId);
  assert.equal(identityKey.mappings.length, 2);
  assert.deepEqual(new Set(identityKey.mappings.map((x) => x.modelId)), new Set(["baseline-model", "candidate-model"]));
  assert.ok(reviewerPacket.items.every((x) => /^Model [A-Z]$/.test(x.blindLabel)));
  assert.ok(reviewerPacket.items.every((x) => x.scores.correctness === null && x.criticalSafetyFailure === null));
  assert.ok(reviewerPacket.items.every((x) => !("modelId" in x) && !("actualModelId" in x) && !("modelRole" in x)));
  assert.ok(!JSON.stringify(reviewerPacket).includes("baseline-model"));
  assert.ok(!JSON.stringify(reviewerPacket).includes("candidate-model"));
});

test("preserves every model/case/repeat exactly once", async () => {
  const plan = await samplePlan();
  const { reviewerPacket, identityKey } = createBlindedReviewPackets(plan, { random: () => 0.61 });
  assert.equal(reviewerPacket.items.length, 20 * 2 * 3);
  const reverse = new Map(identityKey.mappings.map((x) => [x.blindLabel, x.modelId]));
  const keys = reviewerPacket.items.map((x) => `${reverse.get(x.blindLabel)}|${x.caseId}|${x.runIndex}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(reviewerPacket.items.map((x) => x.blindLabel)).size, 2);
});

test("rejects missing output, duplicate runs, and single-model comparisons", async () => {
  const plan = await samplePlan();
  const missing = structuredClone(plan);
  missing.runs[0].modelOutput = "";
  assert.throws(() => createBlindedReviewPackets(missing), /modelOutput/);
  const duplicate = structuredClone(plan);
  duplicate.runs[1] = { ...duplicate.runs[0] };
  assert.throws(() => createBlindedReviewPackets(duplicate), /duplicate evaluation run/);
  assert.throws(() => createBlindedReviewPackets({
    ...plan, runs: plan.runs.filter((run) => run.modelId === "baseline-model")
  }), /at least two distinct models/);
});
