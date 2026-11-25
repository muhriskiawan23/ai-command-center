import assert from "node:assert/strict";
import test from "node:test";
import { LUNA_SEARCH_RESERVATION_MICRO_USD, runWebSearchV2, searchV2Configured } from "../src/web-search-v2.js";

const query = { category: "jobs", query: "Open hotel jobs in Doha", cityOnly: "di Doha saja" };
const detail = "https://careers.example.com/role/job/P1-7764201-0";
const listing = "https://careers.example.com/jobs?filter%5Bcountry%5D=Qatar";
const location = "https://hotel.example.org/doha/location";
const annotation = url => ({ type: "url_citation", url, title: "Synthetic citation", start_index: 0, end_index: 13 });
const response = urls => Response.json({ status: "completed", output: [
  { type: "web_search_call", status: "completed" },
  { type: "message", role: "assistant", content: [{ type: "output_text", text: "Synthetic job", annotations: urls.map(annotation) }] }
] });
const googleResponse = urls => Response.json({ status: "completed", steps: [
  { type: "google_search_result", result: [{ search_suggestions: '<a href="https://www.google.com/search?q=Doha">Doha</a>' }] },
  { type: "model_output", content: [{ type: "text", text: "Synthetic job", annotations: urls.map(annotation) }] }
] });
function envFor(fetcher, vars = {}) {
  const reservations = [];
  const env = {
    BOR_WEB_SEARCH_MODE: "v2", BOR_WEB_SEARCH_OPENAI_KEY: "synthetic-key",
    BOR_WEB_SEARCH_OPENAI_MODEL: "mock-openai", BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD: "20",
    BOR_WEB_SEARCH_DAILY_CALLS: "10", BOR_WEB_SEARCH_DAILY_MICRO_USD: "500000",
    BOR_WEB_SEARCH_MONTHLY_MICRO_USD: "500000", WEB_SEARCH_V2_FETCHER: fetcher,
    DB: { prepare() { return { bind(...args) { return { async first() {
      reservations.push(args[1]); return { calls: 1 };
    } }; } }; } }, ...vars
  };
  return { env, reservations };
}
const googleVars = {
  BOR_WEB_SEARCH_GOOGLE_KEY: "synthetic-google", BOR_WEB_SEARCH_GOOGLE_MODEL: "mock-google",
  BOR_WEB_SEARCH_GOOGLE_CALL_MICRO_USD: "30", BOR_WEB_SEARCH_GOOGLE_ELIGIBILITY_APPROVED: "true",
  BOR_WEB_SEARCH_GOOGLE_ALLOWED_USER_IDS: "owner"
};

test("strict city search rejects a collection-only answer", async () => {
  const { env, reservations } = envFor(async () => response([listing, location]));
  assert.equal(await runWebSearchV2(env, query, { singleOpenAiAttempt: true }), null);
  assert.equal(reservations.length, 1);
});

test("a second reserved angle can replace a list-only response with one detail citation", async () => {
  let calls = 0;
  const { env, reservations } = envFor(async () => response(++calls === 1 ? [listing, location] : [detail, location]));
  const result = await runWebSearchV2(env, query);
  assert.equal(result.links[0].url, detail);
  assert.equal(calls, 2);
  assert.deepEqual(reservations, [20, 20]);
});

test("multiple distinct vacancy IDs are not accepted for one strict city example", async () => {
  const { env } = envFor(async () => response([detail, "https://careers.example.com/jobs/123456"]));
  assert.equal(await runWebSearchV2(env, query, { singleOpenAiAttempt: true }), null);
});

test("pagination and query-only identifiers do not qualify as stable individual vacancies", async () => {
  const { env } = envFor(async () => response(["https://careers.example.com/jobs/page/12345", "https://careers.example.com/job-details/?jobref=12345"]));
  assert.equal(await runWebSearchV2(env, query, { singleOpenAiAttempt: true }), null);
});

test("credential-bearing citations are dropped before being rendered", async () => {
  const { env } = envFor(async () => response(["https://careers.example.com/jobs/123456?access_token=synthetic-secret", detail, location]));
  const result = await runWebSearchV2(env, query, { singleOpenAiAttempt: true });
  assert.equal(result.links.length, 2);
  assert.ok(!JSON.stringify(result).includes("synthetic-secret"));
});

test("eligible Google fallback also rejects collection-only strict city results", async () => {
  const { env } = envFor(async url => url.includes("openai.com") ? response([listing]) : googleResponse([listing]), googleVars);
  assert.equal(await runWebSearchV2(env, query, { allowGoogle: true, singleOpenAiAttempt: true }), null);
});

test("Luna search refuses an underfunded reservation before any provider call", async () => {
  let calls = 0;
  const { env, reservations } = envFor(async () => { calls++; return response([detail]); }, {
    BOR_WEB_SEARCH_OPENAI_MODEL: "gpt-6-luna",
    BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD: String(LUNA_SEARCH_RESERVATION_MICRO_USD - 1)
  });
  assert.equal(searchV2Configured(env), false);
  assert.equal(await runWebSearchV2(env, query), null);
  assert.equal(calls, 0);
  assert.equal(reservations.length, 0);
});

test("Luna normal request uses evaluated model settings and explicit project routing", async () => {
  const { env, reservations } = envFor(async (url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal(payload.model, "gpt-6-luna");
    assert.equal(payload.store, false);
    assert.equal(payload.max_output_tokens, 2000);
    assert.equal(payload.max_tool_calls, 2);
    assert.equal(payload.service_tier, "default");
    assert.deepEqual(payload.reasoning, { effort: "low" });
    assert.equal(options.headers["OpenAI-Organization"], "org-test123");
    assert.equal(options.headers["OpenAI-Project"], "proj_test123");
    assert.ok(!options.body.includes("synthetic-key"));
    return response([detail, location]);
  }, { BOR_WEB_SEARCH_OPENAI_MODEL: "gpt-6-luna",
    BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD: String(LUNA_SEARCH_RESERVATION_MICRO_USD),
    BOR_WEB_SEARCH_OPENAI_ORG: "org-test123", BOR_WEB_SEARCH_OPENAI_PROJECT: "proj_test123" });
  assert.ok(await runWebSearchV2(env, query, { singleOpenAiAttempt: true }));
  assert.deepEqual(reservations, [LUNA_SEARCH_RESERVATION_MICRO_USD]);
});

test("partial or malformed explicit organization routing fails closed", async () => {
  let calls = 0;
  const { env } = envFor(async () => { calls++; return response([detail]); }, {
    BOR_WEB_SEARCH_OPENAI_ORG: "org-test123"
  });
  assert.equal(searchV2Configured(env), false);
  env.BOR_WEB_SEARCH_OPENAI_PROJECT = "bad project";
  assert.equal(await runWebSearchV2(env, query), null);
  assert.equal(calls, 0);
});
