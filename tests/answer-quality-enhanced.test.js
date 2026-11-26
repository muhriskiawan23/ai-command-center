import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { answerDepth, qualityOutputLimit } from "../src/answer-quality.js";
import { DEFAULT_MODEL_ID } from "../src/model-gateway.js";
import { withTextProviderFailover } from "../src/text-provider-failover.js";
import { planWebSearch, runWebSearchV2 } from "../src/web-search-v2.js";
import { createD1, seedSession } from "./e2e/harness.js";

const enhanced = { BOR_ANSWER_QUALITY_PROFILE: "enhanced" };
test("adaptive detail is opt-in, respects brevity and caps final-agent output", () => {
  assert.equal(answerDepth("Jawab singkat: apa itu data?", "detailed"), "compact");
  assert.equal(answerDepth("Jawab hanya angka: 17 dikali 19."), "compact");
  assert.equal(answerDepth("Answer with only the number: 17 times 19."), "compact");
  assert.equal(answerDepth("Jelaskan detail proses ini", "short"), "detailed");
  assert.equal(answerDepth("Apa penyebabnya? Apa dampaknya?"), "detailed");
  assert.equal(qualityOutputLimit(950, "coordinator", "Jelaskan detail proses ini", {}), 950);
  assert.equal(qualityOutputLimit(950, "coordinator", "Apa penyebabnya? Apa dampaknya?", enhanced), 1800);
  assert.equal(qualityOutputLimit(1800, "writer", "Jelaskan detail", enhanced), 2200);
  assert.equal(qualityOutputLimit(500, "researcher", "Jelaskan detail", enhanced), 500);
  assert.equal(qualityOutputLimit(950, "coordinator", "Jawab singkat: apa itu data?", enhanced), 950);
});
test("chat uses adaptive allowance once and accepts an explicitly concise answer", async () => {
  for (const [message, text, tokens] of [
    ["Apa fungsi panel surya? Apa manfaatnya?", "Panel surya mengubah sinar matahari menjadi listrik yang dapat mengurangi penggunaan energi dari jaringan.", 1800],
    ["Jawab singkat: ibu kota Jepang?", "Tokyo.", 950],
    ["Jawab hanya angka: 17 dikali 19.", "323", 950]
  ]) {
    let calls = 0;
    const response = await worker.fetch(new Request("https://bor.example/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, language: "id" }) }), { ...enhanced, BOR_WEB_SEARCH_MODE: "off", AI: { run: async (_model, payload) => { calls++; assert.equal(payload.max_tokens, tokens); return { response: text }; } } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).response, text);
    assert.equal(calls, 1);
  }
});
test("Luna low reasoning requires both flags and long tool-free calls with an upfront reservation", async () => {
  for (const [flags, max_tokens, tools, effort] of [
    [{}, 1800, undefined, "none"], [enhanced, 1800, undefined, "none"],
    [{ ...enhanced, BOR_TEXT_LUNA_REASONING_LOW_ENABLED: "true" }, 950, undefined, "none"],
    [{ ...enhanced, BOR_TEXT_LUNA_REASONING_LOW_ENABLED: "true" }, 1800, undefined, "low"],
    [{ ...enhanced, BOR_TEXT_LUNA_REASONING_LOW_ENABLED: "true" }, 1800, [{ name: "fixture", parameters: { type: "object" } }], "none"]
  ]) {
    let reserved = false, calls = 0;
    const env = withTextProviderFailover({ ...flags, BOR_TEXT_BACKUP_ENABLED: "true", BOR_TEXT_LUNA_PRIMARY: "true", BOR_TEXT_BACKUP_API_KEY: "mock", BOR_TEXT_BACKUP_DAILY_USD_LIMIT: "1", DB: { prepare: () => ({ bind: (_day, _subject, cost) => ({ first: async () => { assert.ok(cost >= Math.ceil(max_tokens * 0.5)); reserved = true; return { units: cost }; } }) }) }, AI: { run: async () => { throw Error("Unexpected fallback"); } } }, async (_url, req) => {
      calls++; assert.ok(reserved); const body = JSON.parse(req.body); assert.equal(body.reasoning_effort, effort); assert.equal(body.max_completion_tokens, max_tokens); assert.equal(body.store, false); return Response.json({ choices: [{ message: { role: "assistant", content: "Fixture" } }] });
    });
    assert.equal((await env.AI.run(DEFAULT_MODEL_ID, { messages: [{ role: "user", content: "fixture" }], max_tokens, ...(tools ? { tools } : {}) })).response, "Fixture");
    assert.equal(calls, 1);
  }
});
test("long public question plan preserves task without bypassing privacy filter", async () => {
  const long = "Give the official public information about a synthetic sample mission. " + "Explain the source, timing, quantity and technical cause of each stage. ".repeat(10).trimEnd();
  assert.ok(long.length > 620 && long.length < 1200);
  let calls = 0;
  const ai = { run: async (_model, body) => { calls++; assert.equal(body.max_tokens, 520); return { response: JSON.stringify({ search: true, category: "general", query: long }) }; } };
  assert.equal((await planWebSearch(ai, long)).query, long);
  assert.equal(await planWebSearch(ai, long + " owner@example.com"), null);
  assert.equal(calls, 1);
  assert.equal(await planWebSearch({ run: async () => ({ response: JSON.stringify({ search: true, category: "general", query: "Contact owner@example.com" }) }) }, long), null);
});
const fixtureText = "The public fixture states an initial mass of 70 grams.";
function fixtureEnv(status, reason, cited = true) {
  const DB = createD1(); let calls = 0;
  const env = { DB, BOR_WEB_SEARCH_MODE: "v2", BOR_WEB_SEARCH_PILOT_USER_IDS: "pilot", BOR_WEB_SEARCH_USER_DAILY_CALLS: "2", BOR_WEB_SEARCH_DAILY_CALLS: "2", BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD: "260000", BOR_WEB_SEARCH_DAILY_MICRO_USD: "520000", BOR_WEB_SEARCH_MONTHLY_MICRO_USD: "520000", BOR_WEB_SEARCH_OPENAI_KEY: "mock", WEB_SEARCH_V2_FETCHER: async () => { calls++; return Response.json({ status, incomplete_details: { reason }, output: [{ type: "web_search_call", status: "completed" }, { type: "message", role: "assistant", content: [{ type: "output_text", text: fixtureText, annotations: cited ? [{ type: "url_citation", url: "https://example.com/fact", start_index: 0, end_index: fixtureText.length }] : [] }] }] }); } };
  return { env, calls: () => calls };
}
test("cited partial web search is retained without a second paid attempt; unsafe incomplete results fail closed", async () => {
  for (const [reason, cited, allowed] of [["max_output_tokens", true, true], ["max_output_tokens", false, false], ["content_filter", true, false]]) {
    const f = fixtureEnv("incomplete", reason, cited);
    try { const result = await runWebSearchV2(f.env, { category: "general", query: "Public fixture question" }, { userId: "pilot" }); assert.equal(Boolean(result), allowed); if (allowed) { assert.equal(result.partial, true); assert.match(result.text, /70 grams/); assert.equal(result.links.length, 1); } assert.equal(f.calls(), 1); } finally { f.env.DB.sqlite.close(); }
  }
});
test("production chat path labels cited truncated search output as partial", async () => {
  const f = fixtureEnv("incomplete", "max_output_tokens");
  try {
    const token = seedSession(f.env.DB, { id: "pilot", email: "pilot@example.invalid" });
    f.env.AI = { run: async () => ({ response: JSON.stringify({ search: true, category: "general", query: "Public fixture question" }) }) };
    const response = await worker.fetch(new Request("https://bor.example/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://bor.example", Cookie: "__Host-borai_session=" + token }, body: JSON.stringify({ message: "Public fixture question", language: "en" }) }), f.env);
    assert.equal(response.status, 200); const result = await response.json(); assert.match(result.response, /^\*\*Partial answer:/); assert.match(result.response, /70 grams/); assert.equal(result.links.length, 1); assert.equal(result.toolActivity[0].status, "partial"); assert.equal(f.calls(), 1);
  } finally { f.env.DB.sqlite.close(); }
});
