import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function itemKey(item) {
  return JSON.stringify([item.caseId, item.blindLabel, item.runIndex]);
}

function validateReviewer(review, index, expected) {
  const label = `reviewers[${index}]`;
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    throw new TypeError(`${label} must be an object`);
  }
  if (!nonEmpty(review.reviewerId)) throw new TypeError(`${label}.reviewerId must be a non-empty string`);
  const packet = review.reviewerPacket;
  if (!packet || typeof packet !== "object" || Array.isArray(packet) ||
      !Array.isArray(packet.items) || !Array.isArray(packet.scoreDimensions)) {
    throw new TypeError(`${label}.reviewerPacket must contain items and scoreDimensions`);
  }
  if (packet.packetId !== expected.packetId || packet.packetVersion !== expected.packetVersion ||
      JSON.stringify(packet.scoreDimensions) !== JSON.stringify(expected.scoreDimensions)) {
    throw new TypeError(`${label} packet identity/version/dimensions do not match`);
  }
  if (packet.identityKey !== undefined || review.identityKey !== undefined) {
    throw new TypeError(`${label} must not include an identity key`);
  }
  const seen = new Set();
  for (const [itemIndex, item] of packet.items.entries()) {
    const itemLabel = `${label}.reviewerPacket.items[${itemIndex}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new TypeError(`${itemLabel} must be an object`);
    }
    for (const key of ["caseId", "blindLabel"]) {
      if (!nonEmpty(item[key])) throw new TypeError(`${itemLabel}.${key} must be a non-empty string`);
    }
    if (!Number.isSafeInteger(item.runIndex) || item.runIndex < 1) {
      throw new TypeError(`${itemLabel}.runIndex must be a positive safe integer`);
    }
    const key = itemKey(item);
    if (seen.has(key)) throw new TypeError(`${label} contains duplicate review item ${key}`);
    seen.add(key);
    if (!item.scores || typeof item.scores !== "object" || Array.isArray(item.scores)) {
      throw new TypeError(`${itemLabel}.scores must be an object`);
    }
    for (const dimension of expected.scoreDimensions) {
      const score = item.scores[dimension];
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        throw new TypeError(`${itemLabel}.scores.${dimension} must be an integer from 1 to 5`);
      }
    }
    if (typeof item.criticalSafetyFailure !== "boolean") {
      throw new TypeError(`${itemLabel}.criticalSafetyFailure must be boolean`);
    }
    if (item.reviewerNotes !== undefined && typeof item.reviewerNotes !== "string") {
      throw new TypeError(`${itemLabel}.reviewerNotes must be a string when supplied`);
    }
  }
  if (seen.size !== expected.itemKeys.size ||
      [...expected.itemKeys].some((key) => !seen.has(key))) {
    throw new TypeError(`${label} must score every packet item exactly once`);
  }
}

export function summarizeBlindedReviews(reviews) {
  if (!Array.isArray(reviews) || reviews.length < 2) {
    throw new RangeError("at least two independent reviewer packets are required");
  }
  const first = reviews[0]?.reviewerPacket;
  if (!first || !Array.isArray(first.items) || !Array.isArray(first.scoreDimensions) ||
      !nonEmpty(first.packetId) || !nonEmpty(first.packetVersion) ||
      first.scoreDimensions.length === 0) {
    throw new TypeError("first reviewer packet is missing packet metadata");
  }
  if (new Set(first.scoreDimensions).size !== first.scoreDimensions.length ||
      first.scoreDimensions.some((dimension) => !nonEmpty(dimension))) {
    throw new TypeError("scoreDimensions must contain unique non-empty strings");
  }
  const expected = {
    packetId: first.packetId,
    packetVersion: first.packetVersion,
    scoreDimensions: first.scoreDimensions,
    itemKeys: new Set()
  };
  const baseItems = new Map();
  for (const item of first.items) {
    const key = itemKey(item);
    if (baseItems.has(key)) throw new TypeError("first reviewer packet contains duplicate items");
    baseItems.set(key, item);
    expected.itemKeys.add(key);
  }
  if (!baseItems.size) throw new TypeError("review packet must contain at least one item");

  const reviewerIds = new Set();
  reviews.forEach((review, index) => {
    validateReviewer(review, index, expected);
    if (reviewerIds.has(review.reviewerId)) {
      throw new TypeError(`duplicate reviewerId: ${review.reviewerId}`);
    }
    reviewerIds.add(review.reviewerId);
  });

  const scoreByItem = new Map();
  for (const key of expected.itemKeys) {
    const template = baseItems.get(key);
    const reviewed = reviews.map((review) =>
      review.reviewerPacket.items.find((item) => itemKey(item) === key)
    );
    const dimensions = Object.fromEntries(expected.scoreDimensions.map((dimension) => {
      const scores = reviewed.map((item) => item.scores[dimension]);
      const pairDifferences = [];
      for (let i = 0; i < scores.length; i += 1) {
        for (let j = i + 1; j < scores.length; j += 1) {
          pairDifferences.push(Math.abs(scores[i] - scores[j]));
        }
      }
      return [dimension, {
        mean: mean(scores),
        reviewerScores: [...scores],
        exactAgreement: new Set(scores).size === 1,
        meanPairwiseAbsoluteDifference: mean(pairDifferences)
      }];
    }));
    const safetyFlags = reviewed.map((item) => item.criticalSafetyFailure);
    scoreByItem.set(key, {
      caseId: template.caseId,
      language: template.language,
      task: template.task,
      runIndex: template.runIndex,
      blindLabel: template.blindLabel,
      scores: dimensions,
      criticalSafetyFailure: safetyFlags.some(Boolean),
      reviewerSafetyFlags: [...safetyFlags],
      safetyDisagreement: new Set(safetyFlags).size > 1
    });
  }

  const blindModels = [...new Set([...scoreByItem.values()].map((item) => item.blindLabel))].sort();
  const byBlindModel = Object.fromEntries(blindModels.map((blindLabel) => {
    const items = [...scoreByItem.values()].filter((item) => item.blindLabel === blindLabel);
    const dimensionSummary = Object.fromEntries(expected.scoreDimensions.map((dimension) => {
      const values = items.map((item) => item.scores[dimension].mean);
      const exact = items.filter((item) => item.scores[dimension].exactAgreement).length;
      const differences = items.map((item) => item.scores[dimension].meanPairwiseAbsoluteDifference);
      return [dimension, {
        mean: mean(values),
        count: values.length,
        exactReviewerAgreementRate: exact / items.length,
        meanPairwiseAbsoluteDifference: mean(differences)
      }];
    }));
    const safetyFailures = items.filter((item) => item.criticalSafetyFailure).length;
    return [blindLabel, {
      reviewedItems: items.length,
      scores: dimensionSummary,
      overallMean: mean(items.flatMap((item) => expected.scoreDimensions.map((dimension) => item.scores[dimension].mean))),
      criticalSafetyFailures: safetyFailures,
      criticalSafetyFailureRate: safetyFailures / items.length,
      safetyDisagreements: items.filter((item) => item.safetyDisagreement).length
    }];
  }));

  return {
    consensusVersion: "1.0.0",
    packetId: expected.packetId,
    reviewerCount: reviews.length,
    reviewedItemCount: scoreByItem.size,
    scoreDimensions: [...expected.scoreDimensions],
    byBlindModel,
    byItem: [...scoreByItem.values()].sort((a, b) =>
      a.caseId.localeCompare(b.caseId) || a.blindLabel.localeCompare(b.blindLabel) || a.runIndex - b.runIndex
    ),
    limitations: [
      "Reviewer scores are summarized descriptively; no statistical significance or inter-rater reliability coefficient is inferred.",
      "Exact agreement and mean pairwise absolute score difference are descriptive measures, not proof of reviewer calibration.",
      "A critical safety failure reported by any reviewer is conservatively treated as a failure for that item; disagreements remain visible.",
      "Blind labels are preserved. Identity mapping must only be joined after all reviewers' scores are locked.",
      "This offline tool makes no model/provider calls and does not authorize routing, pilot, or deployment changes."
    ]
  };
}

async function main(args) {
  if (args.length !== 2 || args.includes("--help")) {
    process.stdout.write("Usage: npm run eval:consensus -- scored-review-files.json consensus-report.json\n");
    if (!args.includes("--help")) process.exitCode = 1;
    return;
  }
  const [manifestPath, outputPath] = args;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.reviewFiles) || manifest.reviewFiles.length < 2 ||
      manifest.reviewFiles.some((path) => !nonEmpty(path))) {
    throw new TypeError("manifest.reviewFiles must list at least two scored reviewer packet paths");
  }
  const reviews = await Promise.all(manifest.reviewFiles.map(async (path) => {
    const review = JSON.parse(await readFile(resolve(path), "utf8"));
    return review;
  }));
  const report = summarizeBlindedReviews(reviews);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  process.stdout.write(`Created blinded consensus report for ${report.reviewerCount} reviewers and ${report.reviewedItemCount} items.\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Blinded review consensus failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
