import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const benchmarkUrl = new URL("../evaluation/model-quality-cases.json", import.meta.url);

test("bilingual model-quality benchmark has stable, actionable coverage", async () => {
  const benchmark = JSON.parse(await readFile(benchmarkUrl, "utf8"));
  assert.equal(benchmark.version, "1.2.0");
  assert.equal(benchmark.minimumRunsPerCase, 3);
  assert.ok(Array.isArray(benchmark.cases));
  assert.equal(benchmark.cases.length, 24);

  const ids = new Set();
  const languages = new Set();
  const tasksByLanguage = new Map();
  for (const item of benchmark.cases) {
    assert.match(item.id, /^[a-z]{2}-[a-z]+-\d{3}$/);
    assert.equal(ids.has(item.id), false, `duplicate case id: ${item.id}`);
    ids.add(item.id);
    assert.ok(["id", "en"].includes(item.language));
    languages.add(item.language);
    assert.ok([
      "fast_chat", "deep_reasoning", "research_synthesis", "coding", "translation",
      "multi_turn_context", "structured_extraction", "tool_use", "prompt_injection"
    ].includes(item.task));
    assert.ok(typeof item.prompt === "string" && item.prompt.trim().length >= 30);
    assert.ok(Array.isArray(item.criteria) && item.criteria.length >= 3);
    assert.ok(item.criteria.every((criterion) => typeof criterion === "string" && criterion.trim().length >= 10));
    if (!tasksByLanguage.has(item.language)) tasksByLanguage.set(item.language, new Set());
    tasksByLanguage.get(item.language).add(item.task);
  }

  const financeCases = benchmark.cases.filter((item) => item.id.endsWith("finance-ratio-001"));
  assert.deepEqual(financeCases.map((item) => item.language).sort(), ["en", "id"]);
  assert.ok(financeCases.every((item) => item.criteria.some((criterion) => /40%/.test(criterion))));
  assert.ok(financeCases.every((item) => item.criteria.some((criterion) => /6%/.test(criterion))));
  assert.ok(financeCases.every((item) => item.criteria.some((criterion) => /2[.,]5/.test(criterion))));
  const sourceCases = benchmark.cases.filter((item) => item.id.endsWith("source-discipline-001"));
  assert.deepEqual(sourceCases.map((item) => item.language).sort(), ["en", "id"]);
  assert.ok(sourceCases.every((item) => /do not guess|jangan menebak/i.test(item.prompt)));

  assert.deepEqual([...languages].sort(), ["en", "id"]);
  const expectedTasks = [
    "fast_chat", "deep_reasoning", "research_synthesis", "coding", "translation",
    "multi_turn_context", "structured_extraction", "tool_use", "prompt_injection"
  ];
  for (const language of languages) {
    assert.deepEqual([...tasksByLanguage.get(language)].sort(), [...expectedTasks].sort(),
      `${language} benchmark must cover every required task`);
  }
});
