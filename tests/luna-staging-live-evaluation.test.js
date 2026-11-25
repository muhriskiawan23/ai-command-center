import assert from "node:assert/strict";
import test from "node:test";
import { runLunaStagingEvaluation } from "../src/luna-staging-live-evaluation.js";
import { createD1 } from "./e2e/harness.js";

function fixture(t) {
  const DB = createD1();
  DB.sqlite.exec("CREATE TABLE web_search_v2_live_evaluation (id TEXT PRIMARY KEY, status TEXT NOT NULL, evidence_json TEXT)");
  t.after(() => DB.sqlite.close());
  return {
    env: { DB, BOR_TEXT_BACKUP_API_KEY: "mock-key", BOR_LUNA_LIVE_EVAL_ID: "web-v2-synthetic-test", BOR_LUNA_LIVE_EVAL_EXPIRES_AT: String(Date.now() + 60000) },
    result() {
      const row = DB.sqlite.prepare("SELECT status, evidence_json FROM web_search_v2_live_evaluation").get();
      return { status: row?.status, evidence: row?.evidence_json ? JSON.parse(row.evidence_json) : null };
    }
  };
}

const usage = { input_tokens: 400, output_tokens: 50, input_tokens_details: { cached_tokens: 20 } };
const message = (text, annotations = []) => ({ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations }] });

test("the isolated staging runner admits exactly one evaluation and reports usage for all six searches", async t => {
  const { env, result } = fixture(t);
  const payloads = [];
  const fetcher = async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(options.headers.Authorization, "Bearer mock-key");
    const body = JSON.parse(options.body);
    payloads.push(body);
    if (!body.tools) return Response.json({ usage, output: [message(JSON.stringify({
      search: true, category: "agency", query: "Agensi perhotelan Jakarta untuk penempatan Timur Tengah"
    }))] });
    assert.equal(body.max_tool_calls, 2);
    return Response.json({ status: "completed", usage, output: [
      { type: "web_search_call", status: "completed" }, message("Hasil uji.", [
        { type: "url_citation", url: "https://example.com/agency", start_index: 0, end_index: 10 }
      ])
    ] });
  };
  await Promise.all([runLunaStagingEvaluation(env, fetcher), runLunaStagingEvaluation(env, fetcher)]);
  assert.equal(payloads.length, 12);
  assert.match(payloads[10].input[1].content, /Lowongan kerja perhotelan terbaru di Qatar/);
  const saved = result();
  assert.equal(saved.status, "completed");
  assert.deepEqual(saved.evidence.evidence.map(x => x.usage.webCalls), [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
  assert.equal(saved.evidence.results[0].sources[0].url, "https://example.com/agency");
  assert.doesNotMatch(JSON.stringify(saved), /mock-key/);
});

test("an insufficient-quota response stops before any additional API call", async t => {
  const { env, result } = fixture(t);
  let calls = 0;
  await runLunaStagingEvaluation(env, async () => {
    calls++;
    return Response.json({ error: { code: "insufficient_quota", message: "omitted" } }, { status: 429 });
  });
  assert.equal(calls, 1);
  assert.equal(result().status, "stopped");
  assert.equal(result().evidence.evidence[0].error, "insufficient_quota");
  assert.doesNotMatch(JSON.stringify(result()), /omitted/);
});

test("long-context usage settles at premium rates and the next unsafe reservation is denied", async t => {
  const { env, result } = fixture(t);
  let searchCalls = 0;
  await runLunaStagingEvaluation(env, async (_url, options) => {
    const body = JSON.parse(options.body);
    if (!body.tools) return Response.json({ usage, output: [message('{"search":true,"category":"agency","query":"Agensi perhotelan Jakarta"}')] });
    searchCalls++;
    return Response.json({ status: "completed", usage: { input_tokens: 900000, output_tokens: 400 },
      output: [{ type: "web_search_call", status: "completed" }, message("Hasil uji.", [
        { type: "url_citation", url: "https://example.com/agency", start_index: 0, end_index: 10 }
      ])] });
  });
  const saved = result();
  assert.equal(searchCalls, 2);
  assert.equal(saved.status, "stopped");
  assert.equal(saved.evidence.stopped, "budget_limit");
  assert.equal(saved.evidence.evidence.find(x => x.phase === "search").costMicroUsd, 190300);
});

test("model metadata success cannot mask a billing rejection from Responses", async t => {
  const { env, result } = fixture(t);
  env.BOR_LUNA_VERIFY_MODEL = "true";
  const calls = [];
  await runLunaStagingEvaluation(env, async (url, options) => {
    calls.push({ url, method: options.method });
    if (options.method === "GET") return Response.json({ id: "gpt-6-luna" });
    return Response.json({ error: { code: "billing_not_active", type: "billing_not_active", message: "Billing is not active" } }, { status: 429 });
  });
  assert.deepEqual(calls, [
    { url: "https://api.openai.com/v1/models/gpt-6-luna", method: "GET" },
    { url: "https://api.openai.com/v1/responses", method: "POST" }
  ]);
  assert.equal(result().status, "stopped");
  assert.equal(result().evidence.chargedMicroUsd, 0);
  assert.equal(result().evidence.evidence[1].error, "billing_not_active");
});

test("a Cloudflare key that differs from the selected project key stops before sending any request", async t => {
  const { env, result } = fixture(t);
  env.BOR_LUNA_EXPECTED_KEY_SUFFIX = "ABCD";
  await runLunaStagingEvaluation(env, async () => assert.fail("mismatched key reached OpenAI"));
  assert.equal(result().evidence.stopped, "staging_key_mismatch");
  assert.deepEqual(result().evidence.evidence, [{ phase: "key_identity", dashboardSuffixMatches: false }]);
});

test("a single-scenario retry imports the prior spend and refuses a search above the campaign cap", async t => {
  const { env, result } = fixture(t);
  env.BOR_LUNA_ONLY_CASE = "6";
  env.BOR_LUNA_RESUME_ID = "web-v2-completed-stage";
  await env.DB.prepare("INSERT INTO web_search_v2_live_evaluation (id,status,evidence_json) VALUES (?, 'completed', ?)").bind(
    env.BOR_LUNA_RESUME_ID, '{"chargedMicroUsd":270000}'
  ).run();
  let calls = 0;
  await runLunaStagingEvaluation(env, async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.equal(body.tools, undefined);
    assert.match(body.input[0].content, /Preserve explicit constraints/);
    assert.match(body.input[1].content, /Doha saja/);
    return Response.json({ usage, output: [message('{"search":true,"category":"jobs","query":"Lowongan hotel di Doha saja"}')] });
  });
  assert.equal(calls, 1);
  const retry = await env.DB.prepare("SELECT status,evidence_json FROM web_search_v2_live_evaluation WHERE id = ?").bind(env.BOR_LUNA_LIVE_EVAL_ID).first();
  const saved = JSON.parse(retry.evidence_json);
  assert.equal(saved.stopped, "budget_limit");
  assert.equal(saved.results[0].scenario, 6);
  assert.ok(saved.chargedMicroUsd > 270000);
});
