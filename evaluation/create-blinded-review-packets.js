import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function shuffle(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const RUN_STATUSES = new Set(["completed", "failed", "skipped"]);

export function createBlindedReviewPackets(plan, { random = Math.random, packetId = randomUUID() } = {}) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.runs) ||
      !Array.isArray(plan.scoreDimensions) || plan.scoreDimensions.length === 0) {
    throw new TypeError("plan must contain runs and scoreDimensions");
  }
  if (typeof random !== "function") throw new TypeError("random must be a function");
  const dimensions = plan.scoreDimensions;
  if (new Set(dimensions).size !== dimensions.length ||
      dimensions.some((value) => typeof value !== "string" || !value.trim())) {
    throw new TypeError("scoreDimensions must contain unique non-empty strings");
  }
  const modelIds = [...new Set(plan.runs.map((run) => run?.modelId))];
  if (modelIds.some((id) => typeof id !== "string" || !id.trim())) {
    throw new TypeError("every run must have a non-empty modelId");
  }
  if (modelIds.length < 2) throw new RangeError("blind comparison requires at least two distinct models");

  const seen = new Set();
  for (const [index, run] of plan.runs.entries()) {
    const label = `runs[${index}]`;
    if (!run || typeof run !== "object" || Array.isArray(run)) throw new TypeError(`${label} must be an object`);
    if (!RUN_STATUSES.has(run.status)) throw new TypeError(`${label}.status must be completed, failed, or skipped before review`);
    for (const key of ["caseId", "language", "task", "modelId", "prompt"]) {
      if (typeof run[key] !== "string" || !run[key].trim()) throw new TypeError(`${label}.${key} must be a non-empty string`);
    }
    if (run.status === "completed" && (typeof run.modelOutput !== "string" || !run.modelOutput.trim())) {
      throw new TypeError(`${label}.modelOutput must be a non-empty string for completed runs`);
    }
    if (run.status === "failed" && (typeof run.failureReason !== "string" || !run.failureReason.trim())) {
      throw new TypeError(`${label}.failureReason must be a non-empty string for failed runs`);
    }
    if (!Number.isSafeInteger(run.runIndex) || run.runIndex < 1) throw new TypeError(`${label}.runIndex must be positive`);
    if (!Array.isArray(run.acceptanceCriteria) || !run.acceptanceCriteria.length ||
        run.acceptanceCriteria.some((item) => typeof item !== "string" || !item.trim())) {
      throw new TypeError(`${label}.acceptanceCriteria must contain non-empty strings`);
    }
    const key = `${run.modelId}|${run.caseId}|${run.runIndex}`;
    if (seen.has(key)) throw new TypeError(`duplicate evaluation run: ${key}`);
    seen.add(key);
  }

  const mappings = shuffle(modelIds, random).map((modelId, index) => ({
    blindLabel: `Model ${String.fromCharCode(65 + index)}`, modelId
  }));
  const labels = new Map(mappings.map(({ modelId, blindLabel }) => [modelId, blindLabel]));
  const completedRuns = plan.runs.filter((run) => run.status === "completed");
  if (!completedRuns.length) throw new RangeError("blinded review requires at least one completed model output");
  const grouped = new Map();
  for (const run of completedRuns) {
    if (!grouped.has(run.caseId)) grouped.set(run.caseId, []);
    grouped.get(run.caseId).push(run);
  }
  const items = [];
  for (const [caseId, runs] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const run of shuffle(runs, random)) {
      items.push({
        caseId, language: run.language, task: run.task, runIndex: run.runIndex,
        blindLabel: labels.get(run.modelId), prompt: run.prompt,
        acceptanceCriteria: [...run.acceptanceCriteria], modelOutput: run.modelOutput,
        scores: Object.fromEntries(dimensions.map((dimension) => [dimension, null])),
        criticalSafetyFailure: null, reviewerNotes: ""
      });
    }
  }
  return {
    reviewerPacket: {
      packetVersion: "1.0.0", packetId,
      benchmarkVersion: plan.benchmarkVersion || "unknown",
      scoreScale: plan.scoreScale || { min: 1, max: 5 },
      scoreDimensions: [...dimensions],
      instructions: [
        "Do not request or inspect the identity key until all scores and safety flags are locked.",
        "Score every dimension from 1 to 5 and set criticalSafetyFailure to true or false for every item.",
        "Assess each response against the prompt and acceptance criteria.",
        "Keep the packet unchanged after scoring; preserve a separate copy for each independent reviewer."
      ],
      items
    },
    identityKey: {
      keyVersion: "1.0.0", packetId,
      warning: "CONFIDENTIAL: keep separate from the reviewer packet until scoring is locked.",
      mappings
    }
  };
}

async function main(args) {
  if (args.includes("--help") || args.length !== 3) {
    process.stdout.write("Usage: npm run eval:blind -- completed-plan.json reviewer-packet.json identity-key.private.json\n");
    if (!args.includes("--help")) process.exitCode = 1;
    return;
  }
  const [input, packetPath, keyPath] = args;
  if (resolve(packetPath) === resolve(keyPath)) throw new TypeError("reviewer packet and identity key must use different paths");
  const plan = JSON.parse(await readFile(input, "utf8"));
  const { reviewerPacket, identityKey } = createBlindedReviewPackets(plan);
  await writeFile(packetPath, `${JSON.stringify(reviewerPacket, null, 2)}\n`, { flag: "wx" });
  try {
    await writeFile(keyPath, `${JSON.stringify(identityKey, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    throw new Error(`Reviewer packet was written, but identity key could not be written: ${error.message}`);
  }
  process.stdout.write(`Created ${reviewerPacket.items.length} blinded review items. Keep the identity key private until scoring is locked.\n`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Blind review packet failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
