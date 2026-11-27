// Pernyataan kemampuan nyata harus ikut ke SETIAP agent, agar model tidak mengaku bisa browsing / berita / file.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createD1, seedSession, startHarness } from "./e2e/harness.js";

test("setiap mode agent menerima pernyataan kemampuan nyata di system prompt", async () => {
  const app = await startHarness();
  const agents = (await (await fetch(app.url + "/api/agents")).json()).agents.map((a) => a.id);
  assert.ok(agents.length >= 9, `hanya ${agents.length} agent terdaftar`);
  for (const agent of agents) {
    app.aiCalls.length = 0;
    const res = await fetch(app.url + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: app.url }, body: JSON.stringify({ message: "Apa yang bisa kamu lakukan?", agent }) });
    assert.equal(res.status, 200, `agent ${agent} gagal: ${res.status}`);
    assert.ok(app.aiCalls.length >= 1);
    for (const call of app.aiCalls) {
      const system = call.messages.find((m) => m.role === "system").content;
      assert.match(system, /distinguish feature availability from evidence retrieved for this turn/, `agent ${agent} tidak membawa pernyataan kemampuan`);
      assert.match(system, /never present information as current/i);
    }
  }
  await app.close();
});

const origin = "https://bor.example";
function ask(env, message, { token, requestId, ...body } = {}) {
  return worker.fetch(new Request(origin + "/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      ...(token ? { Cookie: `__Host-borai_session=${token}` } : {})
    },
    body: JSON.stringify({ message, language: "id", requestId, ...body })
  }), env);
}

function noInference(t) {
  return {
    AI: { run: t.mock.fn(async () => { throw Error("unexpected inference"); }) },
    TAVILY_EXTRACT_FETCHER: t.mock.fn(async () => { throw Error("unexpected extraction"); })
  };
}

test("the question from the screenshot reflects legacy web and URL capability without an external call", async t => {
  const DB = createD1();
  t.after(() => DB.sqlite.close());
  const spies = noInference(t);
  const env = { DB, ...spies, SEARCH_PROVIDER: "tavily", TAVILY_API_KEY: "fake-key", URL_READER_ENABLED: "true",
    URL_READER_PROVIDER: "tavily", TAVILY_EXTRACT_DAILY_URL_LIMIT: "10" };
  const res = await ask(env, "Apa kekuranganmu?");
  assert.equal(res.status, 200);
  const answer = await res.json();
  assert.equal(answer.workflow, "capability-overview");
  assert.match(answer.response, /bisa mencoba mencari sumber publik/);
  assert.match(answer.response, /Kirim URL publik/);
  assert.match(answer.response, /Masuk untuk memberi umpan balik/);
  assert.doesNotMatch(answer.response, /fake-key|tavily/i);
  assert.equal(answer.links, undefined);
  assert.equal(answer.toolActivity, undefined);
  assert.equal(answer.model, undefined);
  assert.equal(spies.AI.run.mock.callCount(), 0);
  assert.equal(spies.TAVILY_EXTRACT_FETCHER.mock.callCount(), 0);
});

test("an English limitation question reflects an unavailable search and a disabled or unconfigured reader", async t => {
  const spies = noInference(t);
  const DB = createD1();
  t.after(() => DB.sqlite.close());
  for (const reader of [
    { URL_READER_ENABLED: "false", TAVILY_EXTRACT_DAILY_URL_LIMIT: "10" },
    { URL_READER_ENABLED: "true", TAVILY_EXTRACT_DAILY_URL_LIMIT: "0" }
  ]) {
    const res = await ask({ DB, ...spies, SEARCH_PROVIDER: "brave", TAVILY_API_KEY: "fake-key",
      URL_READER_PROVIDER: "tavily", ...reader }, "What are your limitations?");
    assert.equal(res.status, 200);
    const answer = await res.json();
    assert.match(answer.response, /Public web search is unavailable in this session/);
    assert.match(answer.response, /External page reading is unavailable in this session/);
  }
  assert.equal(spies.AI.run.mock.callCount(), 0);
  assert.equal(spies.TAVILY_EXTRACT_FETCHER.mock.callCount(), 0);
});

test("a signed-in capability answer is persisted, replayable and accepts feedback from its owner", async t => {
  const DB = createD1();
  t.after(() => DB.sqlite.close());
  const spies = noInference(t);
  const env = { DB, ...spies };
  const token = seedSession(DB, { id: "owner", email: "owner@example.invalid" });
  const requestId = crypto.randomUUID();
  const first = await (await ask(env, "Apa kekurangan lu?", { token, requestId })).json();
  assert.equal(first.saved, true);
  assert.match(first.response, /Pencarian sumber publik belum tersedia/);
  assert.match(first.response, /tekan 👎/);
  const replay = await (await ask(env, "Apa kekurangan lu?", { token, requestId })).json();
  assert.equal(replay.responseId, first.responseId);
  assert.equal(replay.response, first.response);
  assert.equal(replay.replayed, true);
  const feedback = await worker.fetch(new Request(origin + "/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, Cookie: `__Host-borai_session=${token}` },
    body: JSON.stringify({ conversationId: first.conversationId, responseId: first.responseId, rating: "not_helpful" })
  }), env);
  assert.equal(feedback.status, 200);
  assert.equal((await feedback.json()).saved, true);
  assert.equal(spies.AI.run.mock.callCount(), 0);
});

test("multicomponent strategy questions and attachment turns still reach the model", async t => {
  const app = await startHarness();
  t.after(() => app.close());
  for (const [message, extra] of [
    ["Apa kekurangan lu? Bagaimana BOR AI bisa bersaing di pasar global?", {}],
    ["Apa kekuranganmu?", { document: { name: "report.pdf", content: "A synthetic report to review." } }]
  ]) {
    const res = await fetch(app.url + "/api/chat", { method: "POST",
      headers: { "Content-Type": "application/json", Origin: app.url }, body: JSON.stringify({ message, ...extra }) });
    assert.equal(res.status, 200);
    assert.notEqual((await res.json()).workflow, "capability-overview");
  }
  assert.ok(app.aiCalls.length >= 2);
  assert.ok(app.aiCalls.some(call => call.messages.some(message => message.content.includes("A synthetic report to review."))));
});
