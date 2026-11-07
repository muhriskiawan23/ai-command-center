import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const benchmarkUrl = new URL("../evaluation/model-quality-cases.json", import.meta.url);

test("bilingual model-quality benchmark has stable, actionable coverage", async () => {
  const benchmark = JSON.parse(await readFile(benchmarkUrl, "utf8"));
  assert.equal(benchmark.version, "1.0.0");
  assert.ok(Array.isArray(benchmark.cases));
  assert.ok(benchmark.cases.length >= 10);

  const ids = new Set();
  const languages = new Set();
  const tasksByLanguage = new Map();
  for (const item of benchmark.cases) {
    assert.match(item.id, /^[a-z]{2}-[a-z]+-\d{3}$/);
    assert.equal(ids.has(item.id), false, `duplicate case id: ${item.id}`);
    ids.add(item.id);
    assert.ok(["id", "en"].includes(item.language));
    languages.add(item.language);
    assert.ok(["fast_chat", "deep_reasoning", "research_synthesis", "coding", "translation"].includes(item.task));
    assert.ok(typeof item.prompt === "string" && item.prompt.trim().length >= 30);
    assert.ok(Array.isArray(item.criteria) && item.criteria.length >= 3);
    assert.ok(item.criteria.every((criterion) => typeof criterion === "string" && criterion.trim().length >= 10));
    if (!tasksByLanguage.has(item.language)) tasksByLanguage.set(item.language, new Set());
    tasksByLanguage.get(item.language).add(item.task);
  }

  assert.deepEqual([...languages].sort(), ["en", "id"]);
  for (const language of languages) {
    assert.ok(tasksByLanguage.get(language).size >= 5, `${language} benchmark task coverage is too narrow`);
  }
});
