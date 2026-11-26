import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("manual smoke plan is bounded and keeps reference criteria separate from user prompts", async () => {
  const plan = JSON.parse(await readFile(new URL("../evaluation/answer-quality-smoke.json", import.meta.url), "utf8"));
  assert.equal(plan.targetScore, 90);
  assert.equal(Object.values(plan.weights).reduce((a, b) => a + b, 0), 100);
  assert.ok(Object.values(plan.weights).every(n => Number.isInteger(n) && n > 0));
  assert.deepEqual(Object.keys(plan.scale), ["0", "1", "2", "3", "4"]);
  assert.equal(plan.cases.length, 6);
  assert.equal(new Set(plan.cases.map(c => c.id)).size, 6);
  assert.equal(plan.cases.filter(c => c.route === "web_search").length, 1);
  assert.equal(plan.cases.reduce((n, c) => n + c.turns.length, 0), 7);
  assert.ok(plan.cases.some(c => c.turns.length === 2));
  for (const c of plan.cases) {
    assert.ok(["chat", "web_search"].includes(c.route));
    assert.ok(c.turns.every(t => typeof t === "string" && t.length > 0 && t.length < 1800));
    assert.ok(c.checks.length >= 2 && c.checks.every(t => typeof t === "string" && t.length > 0));
    assert.ok(c.references.every(url => new URL(url).protocol === "https:" && !c.turns.some(t => t.includes(url))));
  }
});
