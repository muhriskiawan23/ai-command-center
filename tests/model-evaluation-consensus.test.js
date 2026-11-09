import test from "node:test";
import assert from "node:assert/strict";
import { summarizeBlindedReviews } from "../evaluation/score-blinded-reviews.js";

function fixture() {
  const packet = {
    packetVersion: "1.0.0",
    packetId: "packet-1",
    scoreDimensions: ["correctness", "safety"],
    items: [
      { caseId: "case-1", language: "id", task: "chat", runIndex: 1, blindLabel: "Model A",
        scores: { correctness: null, safety: null }, criticalSafetyFailure: null },
      { caseId: "case-1", language: "id", task: "chat", runIndex: 1, blindLabel: "Model B",
        scores: { correctness: null, safety: null }, criticalSafetyFailure: null }
    ]
  };
  const make = (reviewerId, scores, safety) => ({
    reviewerId,
    reviewerPacket: {
      ...structuredClone(packet),
      items: packet.items.map((item, index) => ({
        ...structuredClone(item),
        scores: { correctness: scores[index][0], safety: scores[index][1] },
        criticalSafetyFailure: safety[index],
        reviewerNotes: ""
      }))
    }
  });
  return [
    make("reviewer-1", [[5, 5], [4, 4]], [false, false]),
    make("reviewer-2", [[4, 5], [2, 3]], [false, true])
  ];
}

test("aggregates independent blind scores and conservative safety flags", () => {
  const report = summarizeBlindedReviews(fixture());
  assert.equal(report.reviewerCount, 2);
  assert.equal(report.reviewedItemCount, 2);
  assert.equal(report.byBlindModel["Model A"].overallMean, 4.75);
  assert.equal(report.byBlindModel["Model A"].scores.correctness.exactReviewerAgreementRate, 0);
  assert.equal(report.byBlindModel["Model A"].scores.correctness.meanPairwiseAbsoluteDifference, 1);
  assert.equal(report.byBlindModel["Model B"].criticalSafetyFailures, 1);
  assert.equal(report.byBlindModel["Model B"].safetyDisagreements, 1);
  assert.equal(report.byItem.find((item) => item.blindLabel === "Model B").criticalSafetyFailure, true);
  assert.ok(report.limitations.some((item) => item.includes("statistical significance")));
});

test("requires two distinct reviewers and rejects duplicate reviewer identities", () => {
  const reviews = fixture();
  assert.throws(() => summarizeBlindedReviews(reviews.slice(0, 1)), /at least two/);
  assert.throws(() => summarizeBlindedReviews([reviews[0], { ...reviews[1], reviewerId: reviews[0].reviewerId }]), /duplicate reviewerId/);
});

test("rejects missing scores, missing safety decisions, and incomplete coverage", () => {
  const reviews = fixture();
  reviews[1].reviewerPacket.items[0].scores.correctness = null;
  assert.throws(() => summarizeBlindedReviews(reviews), /correctness must be an integer/);

  const safety = fixture();
  safety[1].reviewerPacket.items[0].criticalSafetyFailure = null;
  assert.throws(() => summarizeBlindedReviews(safety), /criticalSafetyFailure must be boolean/);

  const coverage = fixture();
  coverage[1].reviewerPacket.items.pop();
  assert.throws(() => summarizeBlindedReviews(coverage), /score every packet item/);
});

test("rejects duplicate items and identity-key leakage", () => {
  const duplicate = fixture();
  duplicate[1].reviewerPacket.items[1] = { ...duplicate[1].reviewerPacket.items[0] };
  assert.throws(() => summarizeBlindedReviews(duplicate), /duplicate review item/);

  const leaked = fixture();
  leaked[1].identityKey = { mappings: [] };
  assert.throws(() => summarizeBlindedReviews(leaked), /must not include an identity key/);
});
