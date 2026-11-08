import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { decideModelAdvancement } from "./decide-model-advancement.js";
import { canonicalJson, verifyEvidenceEnvelope } from "./evidence-provenance.js";

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function itemKey(item) {
  return JSON.stringify([item.caseId, item.language, item.task, item.runIndex, item.blindLabel]);
}

export function unblindAndSelectModels(plan, consensus, identityKey, evidenceEnvelope, trustedPublicKey) {
  if (!evidenceEnvelope || !trustedPublicKey) {
    throw new TypeError("a signed evidence envelope and independently trusted public key are required before unblinding");
  }
  const evidenceVerification = verifyEvidenceEnvelope(evidenceEnvelope, trustedPublicKey);
  if (canonicalJson(plan) !== canonicalJson(evidenceEnvelope.payload)) {
    throw new Error("evaluation plan does not match the signed evidence payload");
  }
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.runs) ||
      !Array.isArray(plan.scoreDimensions) || !plan.scoreDimensions.length) {
    throw new TypeError("evaluation plan must contain runs and scoreDimensions");
  }
  if (!consensus || typeof consensus !== "object" || consensus.consensusVersion !== "1.0.0" ||
      !nonEmpty(consensus.packetId) || !Array.isArray(consensus.scoreDimensions) ||
      !Array.isArray(consensus.byItem) || !Number.isSafeInteger(consensus.reviewerCount) ||
      consensus.reviewerCount < 2) {
    throw new TypeError("consensus report is missing valid version, packet, reviewers, dimensions, or items");
  }
  if (!identityKey || typeof identityKey !== "object" || identityKey.keyVersion !== "1.0.0" ||
      identityKey.packetId !== consensus.packetId || !Array.isArray(identityKey.mappings) ||
      identityKey.mappings.length < 2) {
    throw new TypeError("identity key version/packet or mappings are invalid");
  }
  const dimensions = plan.scoreDimensions;
  if (JSON.stringify(dimensions) !== JSON.stringify(consensus.scoreDimensions) ||
      new Set(dimensions).size !== dimensions.length ||
      dimensions.some((dimension) => !nonEmpty(dimension))) {
    throw new TypeError("plan and consensus score dimensions must match exactly");
  }

  const modelIds = new Set();
  const modelRoles = new Map();
  const plannedItems = new Map();
  for (const [index, run] of plan.runs.entries()) {
    if (!run || typeof run !== "object" || Array.isArray(run) ||
        !["pending", "completed", "failed", "skipped"].includes(run.status)) {
      throw new TypeError(`plan.runs[${index}] must be a valid evaluation run`);
    }
    for (const field of ["modelId", "modelRole", "caseId", "language", "task"]) {
      if (!nonEmpty(run[field])) throw new TypeError(`plan.runs[${index}].${field} must be non-empty`);
    }
    if (!Number.isSafeInteger(run.runIndex) || run.runIndex < 1) {
      throw new TypeError(`plan.runs[${index}].runIndex must be positive`);
    }
    modelIds.add(run.modelId);
    if (modelRoles.has(run.modelId) && modelRoles.get(run.modelId) !== run.modelRole) {
      throw new TypeError(`model ${run.modelId} has inconsistent modelRole values`);
    }
    modelRoles.set(run.modelId, run.modelRole);
    const key = JSON.stringify([run.modelId, run.caseId, run.runIndex]);
    if (plannedItems.has(key)) throw new TypeError(`duplicate planned run: ${key}`);
    plannedItems.set(key, run);
  }

  const mappingByLabel = new Map();
  const mappedModels = new Set();
  for (const [index, mapping] of identityKey.mappings.entries()) {
    if (!mapping || typeof mapping !== "object" ||
        !nonEmpty(mapping.blindLabel) || !nonEmpty(mapping.modelId)) {
      throw new TypeError(`identityKey.mappings[${index}] must contain blindLabel and modelId`);
    }
    if (mappingByLabel.has(mapping.blindLabel) || mappedModels.has(mapping.modelId)) {
      throw new TypeError("identity key contains duplicate blind labels or model IDs");
    }
    mappingByLabel.set(mapping.blindLabel, mapping.modelId);
    mappedModels.add(mapping.modelId);
  }
  if (mappedModels.size !== modelIds.size || [...modelIds].some((id) => !mappedModels.has(id))) {
    throw new TypeError("identity key must map every planned model exactly once and contain no extra models");
  }

  const consensusByItem = new Map();
  for (const [index, item] of consensus.byItem.entries()) {
    if (!item || typeof item !== "object" || !nonEmpty(item.caseId) ||
        !nonEmpty(item.language) || !nonEmpty(item.task) || !nonEmpty(item.blindLabel) ||
        !Number.isSafeInteger(item.runIndex) || item.runIndex < 1) {
      throw new TypeError(`consensus.byItem[${index}] has invalid item identity`);
    }
    const key = itemKey(item);
    if (consensusByItem.has(key)) throw new TypeError(`duplicate consensus item: ${key}`);
    if (!item.scores || typeof item.scores !== "object" || Array.isArray(item.scores)) {
      throw new TypeError(`consensus.byItem[${index}].scores must be an object`);
    }
    for (const dimension of dimensions) {
      const score = item.scores[dimension]?.mean;
      if (!Number.isFinite(score) || score < 1 || score > 5) {
        throw new TypeError(`consensus item score ${dimension} must be a number from 1 to 5`);
      }
    }
    if (typeof item.criticalSafetyFailure !== "boolean") {
      throw new TypeError(`consensus.byItem[${index}].criticalSafetyFailure must be boolean`);
    }
    consensusByItem.set(key, item);
  }

  const unblindedRuns = [];
  const consumedConsensus = new Set();
  for (const run of plan.runs) {
    if (run.status !== "completed") {
      unblindedRuns.push({ ...run });
      continue;
    }
    const blindLabels = [...mappingByLabel.entries()]
      .filter(([, modelId]) => modelId === run.modelId)
      .map(([label]) => label);
    if (blindLabels.length !== 1) throw new TypeError(`model ${run.modelId} must map to exactly one blind label`);
    const blindLabel = blindLabels[0];
    const key = itemKey({ ...run, blindLabel });
    const scored = consensusByItem.get(key);
    if (!scored) throw new TypeError(`consensus is missing planned item for ${run.modelId}/${run.caseId}/${run.runIndex}`);
    consumedConsensus.add(key);
    unblindedRuns.push({
      ...run,
      scores: Object.fromEntries(dimensions.map((dimension) => [dimension, scored.scores[dimension].mean])),
      criticalSafetyFailure: scored.criticalSafetyFailure
    });
  }
  if (consumedConsensus.size !== consensusByItem.size) {
    throw new TypeError("consensus contains items that do not match the evaluation plan and identity key");
  }

  const decision = decideModelAdvancement({ ...plan, runs: unblindedRuns });
  return {
    unblindingVersion: "1.0.0",
    packetId: consensus.packetId,
    reviewerCount: consensus.reviewerCount,
    unblindedItemCount: unblindedRuns.length,
    scoreDimensions: [...dimensions],
    evidenceAttestation: {
      keyId: evidenceVerification.keyId,
      signedAt: evidenceVerification.signedAt,
      payloadSha256: evidenceVerification.payloadSha256,
      evidenceTypes: evidenceVerification.summary.evidenceTypes
    },
    modelMappings: [...mappingByLabel.entries()]
      .map(([blindLabel, modelId]) => ({ blindLabel, modelId }))
      .sort((a, b) => a.modelId.localeCompare(b.modelId)),
    decision,
    governance: [
      "Identity mapping was joined only in this post-consensus step; reviewer packet data remains blind.",
      "Consensus means are preserved as decimal scores without rounding before paired model comparison.",
      "A critical safety failure reported by any reviewer remains a failure after unblinding.",
      "Decision statuses are evidence interpretations only; no model is activated and no production routing is changed.",
      "Only independently verified manual_live operational evidence can support pilot consideration; reviewer consensus alone cannot create missing live measurements."
    ]
  };
}

async function main(args) {
  if (args.length !== 4 || args.includes("--help")) {
    process.stdout.write("Usage: npm run eval:unblind -- completed-plan.json blinded-consensus-report.json identity-key.private.json unblinded-decision.json\n");
    if (!args.includes("--help")) process.exitCode = 1;
    return;
  }
  const [planPath, consensusPath, identityPath, outputPath, evidencePath, publicKeyPath] = args;
  const [plan, consensus, identityKey, evidenceEnvelope, trustedPublicKey] = await Promise.all([
    readFile(planPath, "utf8").then(JSON.parse),
    readFile(consensusPath, "utf8").then(JSON.parse),
    readFile(identityPath, "utf8").then(JSON.parse),
    readFile(evidencePath, "utf8").then(JSON.parse),
    readFile(publicKeyPath, "utf8")
  ]);
  const report = unblindAndSelectModels(plan, consensus, identityKey, evidenceEnvelope, trustedPublicKey);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  process.stdout.write(`Created post-unblinding decision report for ${Object.keys(report.decision.candidates).length} candidates. Keep this report access-controlled.\n`);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Post-evaluation unblinding failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
