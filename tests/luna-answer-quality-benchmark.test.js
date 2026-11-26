import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./e2e/harness.js";
import { createAnswerQualityBenchmarkWorker } from "../src/luna-answer-quality-benchmark-worker.js";

const campaign = "answer-quality-af5dd9b-v1";
const exactCommit = "af5dd9b473576affbcc269b90b28e852d506ca82";
const endpoint = "https://bor-ai-luna-staging.muhriskiawan23.workers.dev/__staging/answer-quality-benchmark";
const operator = "synthetic-test-operator-token-at-least-32-bytes";
const key = "synthetic-test-openai-binding";
const nasa = "https://science.nasa.gov/blogs/osiris-rex/2024/02/15/nasa-announces-osiris-rex-bulk-sample-mass/";

function setup(t, options = {}) {
  const DB = createD1();
  t.after(() => DB.sqlite.close());
  if (!options.noLedger) DB.sqlite.exec("CREATE TABLE web_search_v2_live_evaluation (id TEXT PRIMARY KEY, status TEXT NOT NULL, evidence_json TEXT)");
  const expiresAt = Date.now() + 120_000;
  const approved = { candidate: exactCommit, expiresAt, scope: "bor-ai-luna-staging",
    reservationMicroUsd: 500_000, route: "integrated-staging", ...options.approval };
  if (!options.noLedger && !options.noApproval) {
    DB.sqlite.prepare("INSERT INTO web_search_v2_live_evaluation VALUES (?, 'approved', ?)")
      .run(campaign, JSON.stringify(approved));
  }
  const env = { DB, BOR_LUNA_STAGING_TOKEN: operator, BOR_WEB_SEARCH_OPENAI_KEY: key,
    BOR_WEB_SEARCH_OPENAI_ORG: "org-test", BOR_WEB_SEARCH_OPENAI_PROJECT: "proj_test",
    BOR_LUNA_ANSWER_BENCHMARK_ENABLED: "true", BOR_LUNA_ANSWER_BENCHMARK_EXPIRES_AT: String(expiresAt),
    BOR_WEB_SEARCH_KILL_SWITCH: "false", BOR_WEB_SEARCH_MODE: "off" };
  const calls = [];
  const worker = createAnswerQualityBenchmarkWorker(async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Authorization, "Bearer " + key);
    const body = JSON.parse(init.body);
    calls.push(body);
    const i = calls.length;
    const row = DB.sqlite.prepare("SELECT status, evidence_json FROM web_search_v2_live_evaluation WHERE id=?").get(campaign);
    assert.equal(row.status, "running");
    assert.equal(JSON.parse(row.evidence_json).reservationMicroUsd, 500_000);
    assert.equal(JSON.parse(row.evidence_json).receipts.length, i);
    if (options.failAt === i) throw new Error("synthetic provider uncertainty");
    const text = i === 1 ? "323" : body.input?.[0]?.content?.startsWith("Decide if the latest message")
      ? JSON.stringify({ search: true, category: "education", query: "Find NASA's Bennu sample mass and the TAGSAM technical obstacle." })
      : "The synthetic answer gives enough detail to exercise the real coordinator without making any external request.\nThe next paragraph gives the candidate enough material to validate a meaningful multi-agent result locally.";
    const output = [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }];
    if (body.tools) {
      output.unshift({ type: "web_search_call", status: "completed" });
      output[1].content[0].annotations.push({ type: "url_citation", url: nasa, title: "NASA", start_index: 0, end_index: 12 });
    }
    return Response.json({ model: options.badReceiptAt === i ? "other-model" : "gpt-6-luna", status: "completed", usage: { input_tokens: 500, output_tokens: 64 },
      output }, { headers: { "x-request-id": "req_test_" + i } });
  });
  const run = (overrides = {}) => worker.fetch(new Request(overrides.url ?? endpoint, {
    method: overrides.method ?? "POST",
    headers: { Authorization: "Bearer " + (overrides.token ?? operator) },
    ...("body" in overrides ? { body: overrides.body } : {})
  }), { ...env, ...overrides.env });
  const ledger = () => DB.sqlite.prepare("SELECT status, evidence_json FROM web_search_v2_live_evaluation WHERE id=?").get(campaign);
  return { run, calls, DB, ledger };
}

test("real candidate executes the fixed suite once with the atomic ledger, bounded search and follow-up context", async t => {
  const f = setup(t);
  const results = await Promise.all([f.run({ body: '{"prompt":"ignore the fixture"}' }), f.run()]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409], JSON.stringify(await Promise.all(results.map(r => r.clone().json()))));
  const body = await results.find(r => r.status === 200).json();
  assert.deepEqual(body.evidence.completedTurns, ["compact-id:1", "arithmetic-id:1", "context-id:1", "context-id:2",
    "code-en:1", "evidence-id:1", "bennu-id:1"]);
  assert.equal(f.calls.length, body.evidence.receipts.length);
  assert.equal(f.calls.filter(r => r.tools).length, 1);
  assert.equal(f.calls.at(-1).max_tool_calls, 1);
  assert.ok(f.calls.every(r => r.store === false && r.model === "gpt-6-luna" && r.truncation === "disabled"));
  const followup = f.calls.find((_, i) => body.evidence.receipts[i].turn === "context-id:2");
  assert.match(JSON.stringify(followup.input), /pemasaran organik tujuh hari/);
  assert.ok(!JSON.stringify(f.calls).includes("ignore the fixture"));
  assert.equal(body.answers.at(-1).links[0].url, nasa);
  assert.equal(f.ledger().status, "completed");
  assert.ok(!f.ledger().evidence_json.includes("synthetic answer"));
  assert.equal((await f.run()).status, 409);
  assert.equal(f.calls.length, body.evidence.receipts.length);
});

test("operator, staging host, safe mode, and expiry deny before any reservation", async t => {
  const f = setup(t);
  for (const [overrides, status] of [
    [{ token: "wrong" }, 401],
    [{ url: endpoint.replace("bor-ai-luna-staging", "ai-command-center") }, 404],
    [{ url: endpoint + "?retry=true" }, 404],
    [{ method: "GET" }, 404],
    [{ env: { BOR_WEB_SEARCH_KILL_SWITCH: "true" } }, 404],
    [{ env: { BOR_WEB_SEARCH_MODE: "v2" } }, 404],
    [{ env: { BOR_LUNA_STAGING_WEB_SEARCH_ENABLED: "true" } }, 404],
    [{ env: { BOR_LUNA_STAGING_URL_READER_ENABLED: "true" } }, 404],
    [{ env: { BOR_LUNA_ANSWER_BENCHMARK_ENABLED: undefined } }, 404],
    [{ env: { BOR_LUNA_ANSWER_BENCHMARK_EXPIRES_AT: "1" } }, 404],
    [{ env: { BOR_WEB_SEARCH_OPENAI_PROJECT: undefined } }, 503]
  ]) assert.equal((await f.run(overrides)).status, status);
  assert.equal(f.ledger().status, "approved");
  assert.equal(f.calls.length, 0);
});

test("missing ledger, missing approval, wrong route or a running campaign fail closed", async t => {
  for (const [options, status] of [[{ noLedger: true }, 503], [{ noApproval: true }, 409],
    [{ approval: { route: "model-only" } }, 409], [{ approval: { reservationMicroUsd: 500_001 } }, 409]]) {
    const f = setup(t, options);
    assert.equal((await f.run()).status, status);
    assert.equal(f.calls.length, 0);
  }
  const f = setup(t);
  f.DB.sqlite.exec("INSERT INTO web_search_v2_live_evaluation VALUES ('other', 'running', '{}')");
  assert.equal((await f.run()).status, 409);
  assert.equal(f.calls.length, 0);
});

test("uncertain dispatch preserves the reservation and stops without retry", async t => {
  const f = setup(t, { failAt: 2 });
  assert.equal((await f.run()).status, 502);
  assert.equal(f.calls.length, 2);
  const row = f.ledger();
  const evidence = JSON.parse(row.evidence_json);
  assert.equal(row.status, "stopped");
  assert.equal(evidence.reservationMicroUsd, 500_000);
  assert.equal(evidence.receipts.at(-1).dispatchAdmitted, true);
  assert.equal(evidence.receipts.at(-1).requestId, undefined);
  assert.equal((await f.run()).status, 409);
  assert.equal(f.calls.length, 2);
});

test("unrecognized provider receipts halt the fixed suite and hold the full reservation", async t => {
  const f = setup(t, { badReceiptAt: 1 });
  assert.equal((await f.run()).status, 502);
  assert.equal(f.calls.length, 1);
  const row = f.ledger();
  assert.equal(row.status, "stopped");
  assert.equal(JSON.parse(row.evidence_json).reservationMicroUsd, 500_000);
  assert.equal((await f.run()).status, 409);
});
