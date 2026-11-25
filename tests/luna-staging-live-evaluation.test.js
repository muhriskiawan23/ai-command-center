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
