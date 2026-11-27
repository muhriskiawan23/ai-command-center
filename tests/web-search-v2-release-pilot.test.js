import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { runWebSearchV2 } from "../src/web-search-v2.js";
import { createD1, seedSession } from "./e2e/harness.js";

const price = 260000;
const query = { category: "technology", query: "What is the latest public product update?" };
const answer = "The synthetic release notes provide the latest public product update.";
const april = Date.UTC(2026, 3, 1, 12);

function setup() {
  const requests = [];
  const env = {
    DB: createD1(),
    BOR_WEB_SEARCH_MODE: "v2",
    BOR_WEB_SEARCH_PILOT_USER_IDS: "pilot-a,pilot-b,pilot-c",
    BOR_WEB_SEARCH_USER_DAILY_CALLS: "1",
    BOR_WEB_SEARCH_DAILY_CALLS: "2",
    BOR_WEB_SEARCH_DAILY_MICRO_USD: String(price * 2),
    BOR_WEB_SEARCH_MONTHLY_MICRO_USD: String(price * 3),
    BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD: String(price),
    BOR_WEB_SEARCH_OPENAI_KEY: "mock-provider-key",
    async WEB_SEARCH_V2_FETCHER(url, options) {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(options.body);
      assert.equal(body.model, "gpt-6-luna");
      assert.equal(body.store, false);
      requests.push(body);
      return Response.json({ status: "completed", output: [
        { type: "web_search_call", status: "completed" },
        { type: "message", role: "assistant", content: [{ type: "output_text", text: answer,
          annotations: ["https://example.com/release", "https://example.org/release"].map(url => ({
            type: "url_citation", url, title: "Synthetic release", start_index: 0, end_index: answer.length
          }))
        }] }
      ] });
    }
  };
  return { env, requests };
}

const search = (env, userId, now = april) => runWebSearchV2(env, query, { userId, now });
const ledger = (env, day) => env.DB.sqlite.prepare("SELECT calls, reserved_micro_usd FROM web_search_v2_usage WHERE day=?").get(day);
const origin = "https://bor.example";
async function chat(env, message, token, options = {}) {
  return worker.fetch(new Request(origin + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, ...(token ? { Cookie: "__Host-borai_session=" + token } : {}) },
    body: JSON.stringify({ message, language: "en", ...options })
  }), env);
}

test("a signed-in search follow-up retains the hotel job context and cites fresh Doha sources", async t => {
  const { env } = setup();
  t.after(() => env.DB.sqlite.close());
  env.BOR_WEB_SEARCH_USER_DAILY_CALLS = "2";
  const cookie = seedSession(env.DB, { id: "pilot-a", email: "pilot-a@example.invalid" });
  const firstQuestion = "Cari agensi di Jakarta untuk kerja perhotelan di Timur Tengah.";
  const followUp = "Kalau posisi di Doha?";
  const dohaQuery = "Agensi di Jakarta untuk posisi kerja perhotelan di Doha, Qatar";
  const routerInputs = [];
  const searchQueries = [];
  const results = [
    {
      answer: "Sumber simulasi mencantumkan agensi di Jakarta untuk kerja perhotelan di Timur Tengah.",
      urls: ["https://example.com/jakarta", "https://example.org/middle-east"]
    },
    {
      answer: "Sumber simulasi mencantumkan posisi resepsionis hotel di Doha.",
      urls: ["https://example.com/doha-careers", "https://example.org/doha-careers"]
    }
  ];
  env.AI = { async run(_model, body) {
    const input = JSON.parse(body.messages[1].content);
    routerInputs.push(input);
    const hasContext = input.prompt === followUp && input.previous.includes(firstQuestion);
    return { response: JSON.stringify({
      search: input.prompt === firstQuestion || hasContext,
      category: "general",
      query: hasContext ? dohaQuery : firstQuestion
    }) };
  } };
  env.WEB_SEARCH_V2_FETCHER = async (_url, options) => {
    const { question } = JSON.parse(JSON.parse(options.body).input);
    searchQueries.push(question);
    const { answer, urls } = results[searchQueries.length - 1];
    return Response.json({ status: "completed", output: [
      { type: "web_search_call", status: "completed" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: answer,
        annotations: urls.map(url => ({
          type: "url_citation", url, title: "Sumber simulasi", start_index: 0, end_index: answer.length
        }))
      }] }
    ] });
  };

  const first = await chat(env, firstQuestion, cookie, { language: "id" });
  assert.equal(first.status, 200);
  const initial = await first.json();
  assert.equal(initial.workflow, "web-search-v2");
  assert.equal(initial.saved, true);
  assert.ok(initial.conversationId);
  assert.deepEqual(initial.links.map(link => link.url), results[0].urls);

  const second = await chat(env, followUp, cookie, { language: "id", conversationId: initial.conversationId });
  assert.equal(second.status, 200);
  const reply = await second.json();
  assert.deepEqual(routerInputs, [{ previous: [], prompt: firstQuestion }, { previous: [firstQuestion], prompt: followUp }]);
  assert.deepEqual(searchQueries, [firstQuestion, dohaQuery]);
  assert.equal(reply.workflow, "web-search-v2");
  assert.equal(reply.saved, true);
  assert.equal(reply.conversationId, initial.conversationId);
  assert.match(reply.response, /resepsionis hotel di Doha/);
  assert.match(reply.response, /⟦1⟧/);
  assert.deepEqual(reply.links.map(link => link.url), results[1].urls);
});

test("concurrent requests enforce the per-account and shared caps in the same D1 statement", async () => {
  const { env, requests } = setup();
  const results = await Promise.all(Array.from({ length: 6 }, () => search(env, "pilot-a")));
  assert.equal(results.filter(Boolean).length, 1);
  assert.ok(await search(env, "pilot-b"));
  assert.equal(await search(env, "pilot-c"), null);
  assert.equal(requests.length, 2);
  assert.deepEqual({ ...ledger(env, "2026-04-01") }, { calls: 2, reserved_micro_usd: price * 2 });
  const subjects = env.DB.sqlite.prepare("SELECT subject FROM web_search_v2_user_usage").all();
  assert.equal(subjects.length, 2);
  assert.ok(subjects.every(row => /^[a-f0-9]{64}$/.test(row.subject)));
});

test("the daily UTC reset does not reset the shared monthly cap, and a new month does", async () => {
  const { env, requests } = setup();
  assert.ok(await search(env, "pilot-a"));
  assert.ok(await search(env, "pilot-b"));
  assert.ok(await search(env, "pilot-a", Date.UTC(2026, 3, 2)));
  assert.equal(await search(env, "pilot-b", Date.UTC(2026, 3, 2)), null);
  assert.ok(await search(env, "pilot-a", Date.UTC(2026, 4, 1)));
  assert.equal(requests.length, 4);
});

test("the pilot rejects guests and nonmembers and fails closed if the quota migration is absent", async () => {
  const { env, requests } = setup();
  assert.equal(await search(env, undefined), null);
  assert.equal(await search(env, "not-enrolled"), null);
  env.DB.sqlite.exec("DROP TABLE web_search_v2_user_usage");
  assert.equal(await search(env, "pilot-a"), null);
  assert.equal(requests.length, 0);
  assert.equal(ledger(env, "2026-04-01"), undefined);
});

test("the production chat entry point restricts Luna to the pilot, leaves Tavily links working, and honors kill switch", async () => {
  const { env, requests } = setup();
  let classifiers = 0;
  let extracts = 0;
  env.AI = { async run(_model, body) {
    if (body.max_tokens === 220) {
      classifiers++;
      return { response: JSON.stringify({ search: true, ...query }) };
    }
    return { response: "This is a synthetic answer based on the available public page." };
  } };
  env.URL_READER_ENABLED = "true";
  env.URL_READER_PROVIDER = "tavily";
  env.TAVILY_API_KEY = "mock-tavily-key";
  env.TAVILY_EXTRACT_DAILY_URL_LIMIT = "2";
  env.TAVILY_EXTRACT_FETCHER = async (_url, options) => {
    extracts++;
    const [url] = JSON.parse(options.body).urls;
    return Response.json({ results: [{ url, raw_content: "A synthetic public document, with enough detail to justify a reference." }] });
  };
  const cookie = seedSession(env.DB, { id: "pilot-a", email: "pilot-a@example.invalid" });
  const out = await chat(env, query.query, cookie);
  assert.equal(out.status, 200);
  const body = await out.json();
  assert.equal(body.workflow, "web-search-v2");
  assert.equal(body.links.length, 2);
  assert.equal(body.saved, true);
  assert.equal(requests.length, 1);
  assert.equal(classifiers, 1);
  const guest = await chat(env, "Explain a stable fact in plain language.");
  assert.equal(guest.status, 200);
  assert.equal(classifiers, 1);
  const link = await chat(env, "Summarize https://example.com/guide", cookie);
  assert.equal(link.status, 200);
  assert.equal(extracts, 1);
  env.BOR_WEB_SEARCH_KILL_SWITCH = "true";
  const off = await chat(env, "Explain a stable fact about public releases.", cookie);
  assert.equal(off.status, 200);
  assert.equal(requests.length, 1);
  assert.equal(classifiers, 1);
});
