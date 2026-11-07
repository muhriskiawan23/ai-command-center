import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dataset = JSON.parse(readFileSync(new URL("../evals/model-quality/cases.json", import.meta.url), "utf8"));
const profiles = new Set([
  "fast_chat", "deep_reasoning", "research_synthesis", "coding",
  "translation", "structured_extraction"
]);

test("model quality evaluation dataset has unique, bilingual, task-labelled fixtures", () => {
  assert.equal(dataset.version, "1.0.0");
  assert.ok(Array.isArray(dataset.cases));
  assert.ok(dataset.cases.length >= 10);
  const ids = new Set();
  const languages = new Set();
  for (const item of dataset.cases) {
    assert.equal(typeof item.id, "string");
    assert.ok(!ids.has(item.id), "duplicate case id: " + item.id);
    ids.add(item.id);
    assert.ok(profiles.has(item.taskProfile), "unknown task profile: " + item.taskProfile);
    assert.ok(["id", "en"].includes(item.language));
    languages.add(item.language);
    assert.ok(typeof item.prompt === "string" && item.prompt.trim().length > 20);
    assert.ok(Array.isArray(item.criteria) && item.criteria.length >= 2);
  }
  assert.deepEqual([...languages].sort(), ["en", "id"]);
});
