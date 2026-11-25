import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";
import { planWebSearch, runWebSearchV2, searchV2Configured } from "../src/web-search-v2.js";
import { createD1, seedSession } from "./e2e/harness.js";

const envFor = fetcher => ({
  BOR_WEB_SEARCH_MODE: "v2", BOR_WEB_SEARCH_OPENAI_KEY: "mock-search-key", BOR_WEB_SEARCH_OPENAI_MODEL: "mock-openai",
  BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD: "20", BOR_WEB_SEARCH_DAILY_CALLS: "10",
  BOR_WEB_SEARCH_DAILY_MICRO_USD: "500", BOR_WEB_SEARCH_MONTHLY_MICRO_USD: "2000",
  WEB_SEARCH_V2_FETCHER: fetcher, DB: createD1()
});
const googleVars = {
  BOR_WEB_SEARCH_GOOGLE_KEY: "mock-google-key", BOR_WEB_SEARCH_GOOGLE_MODEL: "mock-google",
  BOR_WEB_SEARCH_GOOGLE_CALL_MICRO_USD: "30", BOR_WEB_SEARCH_GOOGLE_ELIGIBILITY_APPROVED: "true", BOR_WEB_SEARCH_GOOGLE_ALLOWED_USER_IDS: "search-test-owner"
};
const query = { category: "jobs", query: "Lowongan hotel di Qatar dengan pendaftaran terbuka" };
const citation = (url, text) => ({ type: "url_citation", url, title: "Publication", start_index: 0, end_index: Array.from(text).length });
const openAI = (text, urls) => Response.json({
  status: "completed",
  output: [{ type: "web_search_call", status: "completed", action: { type: "search" } },
    { type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: urls.map(url => citation(url, text)) }] }]
});
const google = (text = "Provider sample Google result.") => Response.json({
  status: "completed",
  steps: [{ type: "google_search_result", result: [{ search_suggestions: '<div><a href="https://www.google.com/search?q=Qatar" target="_blank">Qatar</a></div>' }] },
    { type: "model_output", content: [{ type: "text", text, annotations: [citation("https://example.com/jobs", text)] }] }]
});

const scenarios = [
  ["Agensi kerja perhotelan di Timur Tengah yang ada di Jakarta", "agency", "Agensi hospitality berizin di Jakarta dengan penempatan Timur Tengah", "Agensi Hotel Nusantara (data uji)"],
  ["Ada kerja hotel di Qatar?", "jobs", "Lowongan hotel Qatar yang masih menerima lamaran", "Petugas resepsionis Doha (data uji)"],
  ["Quel téléphone Android à moins de 250 euros ?", "product", "Téléphones Android à moins de 250 euros, prix en France", "Modèle de démonstration à 239 €"],
  ["What's happening in world news?", "news", "Major international news published today", "Example international announcement"],
  ["Dónde queda la sede de esta empresa en Yakarta, Hotel Contoh?", "company", "Dirección de la sede oficial de Hotel Contoh en Yakarta", "Dirección de prueba en Yakarta"],
  ["Kalau yang di Doha saja?", "jobs", "Lowongan hotel di Doha, Qatar, pendaftaran terbuka", "Staf hotel Doha (data uji)"]
];

for (const [message, category, publicQuery, sample] of scenarios) test("Worker search answers mock scenario: " + message, async () => {
  const calls = [];
  const env = envFor(async (url, init) => {
    calls.push([url, init]);
    return openAI(sample, ["https://example.com/primary", "https://example.org/independent"]);
  });
  env.AI = { async run(_model, payload) {
    assert.match(payload.messages[0].content, /public web lookup/);
    const input = JSON.parse(payload.messages[1].content);
    if (message.startsWith("Kalau")) assert.deepEqual(input.previous, ["Ada kerja hotel di Qatar?"]);
    return { response: JSON.stringify({ search: true, category, query: publicQuery, queries: ["Official registry and listings", "Independent public coverage"] }) };
  } };
  const request = new Request("https://app.example/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history: [{ role: "user", content: "Ada kerja hotel di Qatar?" }, { role: "assistant", content: "PRIVATE_ASSISTANT_CONTEXT" }] })
  });
  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.workflow, "web-search-v2");
  assert.match(data.response, /⟦1⟧ ⟦2⟧/);
  assert.ok(data.response.includes(sample));
  assert.equal(data.links.length, 2);
  assert.equal(data.toolActivity[0].provider, "OpenAI");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "https://api.openai.com/v1/responses");
  const input = JSON.parse(calls[0][1].body);
  assert.equal(JSON.parse(input.input).question, publicQuery);
  assert.equal(JSON.parse(input.input).search_angles.length, 2);
  assert.equal(input.store, false);
  assert.ok(!calls[0][1].body.includes("PRIVATE_ASSISTANT_CONTEXT"));
});

test("deeper search is bounded and counts publishers independently of subdomains", async () => {
  const requests = [];
  const env = envFor(async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const urls = requests.length === 1 ? ["https://careers.example.com/a", "https://office.example.com/b"]
      : ["https://example.com/a", "https://example.org/b"];
    return openAI("Public example", urls);
  });
  const result = await runWebSearchV2(env, query);
  assert.equal(requests.length, 2);
  assert.match(requests[1].instructions, /independent angles/);
  assert.equal(requests[1].max_tool_calls, 3);
  assert.equal(result.publishers, 2);
});

test("provider failover uses Google only for an opted-in browser and preserves the suggestion widget", async () => {
  const calls = [];
  const env = Object.assign(envFor(async (url, init) => {
    calls.push(url);
    assert.equal(init.redirect, "manual");
    return url.includes("openai.com") ? new Response("", { status: 429 }) : google();
  }), googleVars);
  const result = await runWebSearchV2(env, query, { allowGoogle: true });
  assert.equal(result.provider, "Google");
  assert.equal(result.googleGrounding.blocks[0].text, "Provider sample Google result.");
  assert.deepEqual(calls, ["https://api.openai.com/v1/responses", "https://generativelanguage.googleapis.com/v1beta/interactions"]);
  calls.length = 0;
  assert.equal(await runWebSearchV2(env, query), null);
  assert.equal(calls.length, 1);
  env.BOR_WEB_SEARCH_GOOGLE_ELIGIBILITY_APPROVED = "false";
  assert.equal(await runWebSearchV2(env, query, { allowGoogle: true }), null);
  assert.equal(calls.length, 2);
});

test("daily call and spend ceilings, monthly ceiling and kill switch deny additional requests", async () => {
  let calls = 0;
  const env = envFor(async () => {
    calls++;
    return openAI("Public sample", ["https://example.com/a", "https://example.org/b"]);
  });
  env.BOR_WEB_SEARCH_DAILY_CALLS = "1";
  env.BOR_WEB_SEARCH_DAILY_MICRO_USD = "25";
  env.BOR_WEB_SEARCH_MONTHLY_MICRO_USD = "40";
  const firstDay = Date.UTC(2026, 10, 25);
  const concurrent = await Promise.all(Array.from({ length: 6 }, () => runWebSearchV2(env, query, { now: firstDay })));
  assert.equal(concurrent.filter(Boolean).length, 1);
  assert.ok(await runWebSearchV2(env, query, { now: firstDay + 86400000 }));
  assert.equal(await runWebSearchV2(env, query, { now: firstDay + 2 * 86400000 }), null);
  assert.equal(calls, 2);
  env.BOR_WEB_SEARCH_KILL_SWITCH = "true";
  assert.equal(searchV2Configured(env), false);
  assert.equal(await runWebSearchV2(env, query, { now: Date.UTC(2026, 11, 1) }), null);
  assert.equal(calls, 2);
});

test("private data, model-authored links, fabricated markers and private source URLs do not become citations", async () => {
  assert.equal(await planWebSearch({ async run() { assert.fail("private prompt must stay outside router"); } }, "Cari atas nama contact@example.com"), null);
  assert.equal(await planWebSearch({ async run() { return { response: '{"search":true,"category":"jobs","query":"Send Authorization: Bearer mocktoken1234"}' }; } }, "Jobs in Doha"), null);
  const text = "🌐 Public source confirms. ⟦1⟧ [9] [fake](https://fake.example/job).";
  const calls = [];
  const env = envFor(async (url, init) => {
    calls.push([url, init]);
    return openAI(text, ["https://127.0.0.1/a", "https://example.com/a", "https://example.org/b"]);
  });
  const result = await runWebSearchV2(env, query);
  assert.equal(result.links.length, 2);
  assert.doesNotMatch(result.text, /fake\.example|\[9\]|127\.0\.0\.1/);
  assert.equal(result.text.match(/⟦1⟧/g).length, 1);
  assert.equal(calls.length, 1);
});

test("Google result content never enters durable chat history", async () => {
  const env = Object.assign(envFor(async url => url.includes("openai.com") ? new Response(null, { status: 503 }) : google("TRANSIENT GOOGLE CONTENT")), googleVars);
  env.AI = { async run() { return { response: JSON.stringify({ search: true, ...query }) }; } };
  const session = seedSession(env.DB, { id: "search-test-owner", email: "mock@example.com" });
  const response = await worker.fetch(new Request("https://app.example/api/chat", {
    method: "POST", headers: { "Content-Type": "application/json", "X-BOR-Chat-Progress": "1", Origin: "https://app.example", Cookie: "__Host-borai_session=" + session },
    body: JSON.stringify({ message: "Cari lowongan di Qatar" })
  }), env);
  const events = (await response.text()).trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.slice(0, -1), [{ type: "searching", provider: "OpenAI" }, { type: "searching", provider: "Google" }]);
  assert.equal(events.at(-1).status, 200);
  assert.equal(events.at(-1).data.saved, true);
  assert.equal(events.at(-1).data.googleGrounding.blocks[0].text, "TRANSIENT GOOGLE CONTENT");
  assert.doesNotMatch(JSON.stringify(env.DB.sqlite.prepare("SELECT content, links_json FROM messages").all()), /TRANSIENT|example.com\/jobs/);
});
