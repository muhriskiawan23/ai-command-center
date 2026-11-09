import test from "node:test";
import assert from "node:assert/strict";
import { createD1 } from "./e2e/harness.js";
import { createSearchCircuitBreaker, searchExternal } from "../src/research.js";

const successResponse = () => new Response(JSON.stringify({
  results: [{
    title: "Budget test result",
    url: "https://publisher.example/article",
    description: "A bounded test result.",
    page_age: "2026-11-09T00:00:00Z"
  }]
}), { status: 200, headers: { "content-type": "application/json" } });

test("shared D1 provider budget atomically caps attempts and records aggregate metrics", async () => {
  const DB = createD1();
  let calls = 0;
  const env = {
    DB,
    SEARCH_SHARED_BUDGET_ENABLED: "true",
    BRAVE_SEARCH_API_KEY: "test-key",
    SEARCH_DAILY_ATTEMPT_LIMIT_BRAVE: "2",
    SEARCH_FETCHER: async () => { calls += 1; return successResponse(); }
  };
  const options = { now: Date.parse("2026-11-09T12:00:00Z"), circuitBreaker: createSearchCircuitBreaker() };
  const first = await searchExternal("budget test", "web", env, options);
  assert.equal(first.provider, "brave");
  assert.equal(first.results[0].ok, true);
  assert.equal(calls, 1);

  const row = DB.sqlite.prepare("SELECT requests, attempts, successes, failures, rate_limited FROM search_provider_usage WHERE day = ? AND provider = ?")
    .get("2026-11-09", "brave");
  assert.deepEqual({ ...row }, { requests: 1, attempts: 1, successes: 1, failures: 0, rate_limited: 0 });

  const second = await searchExternal("budget test again", "web", env, options);
  assert.equal(second.reason, "provider_daily_budget_exhausted");
  assert.equal(calls, 1, "an exhausted shared budget must prevent another provider request");
  DB.sqlite.close();
});

test("shared D1 provider budget charges both upstream attempts when retry is used", async () => {
  const DB = createD1();
  let calls = 0;
  const env = {
    DB,
    SEARCH_SHARED_BUDGET_ENABLED: "true",
    BRAVE_SEARCH_API_KEY: "test-key",
    SEARCH_DAILY_ATTEMPT_LIMIT_BRAVE: "2",
    SEARCH_FETCHER: async () => {
      calls += 1;
      return calls === 1 ? new Response("temporarily unavailable", { status: 503 }) : successResponse();
    }
  };
  const result = await searchExternal("retry budget test", "web", env, {
    now: Date.parse("2026-11-09T12:00:00Z"),
    circuitBreaker: createSearchCircuitBreaker()
  });
  assert.equal(result.results[0].ok, true);
  assert.equal(result.diagnostics.attempts, 2);
  const row = DB.sqlite.prepare("SELECT requests, attempts, successes, failures FROM search_provider_usage WHERE day = ? AND provider = ?")
    .get("2026-11-09", "brave");
  assert.deepEqual({ ...row }, { requests: 1, attempts: 2, successes: 1, failures: 0 });
  DB.sqlite.close();
});

test("live provider calls fail closed when shared D1 budget storage is unavailable", async () => {
  let calls = 0;
  const result = await searchExternal("must fail closed", "web", {
    SEARCH_SHARED_BUDGET_ENABLED: "true",
    BRAVE_SEARCH_API_KEY: "test-key",
    SEARCH_FETCHER: async () => { calls += 1; return successResponse(); }
  }, { circuitBreaker: createSearchCircuitBreaker() });
  assert.equal(result.reason, "provider_budget_unavailable");
  assert.equal(calls, 0);
});

test("shared provider budget remains opt-in until the production D1 migration is applied", async () => {
  let calls = 0;
  const result = await searchExternal("legacy-compatible search", "web", {
    BRAVE_SEARCH_API_KEY: "test-key",
    SEARCH_FETCHER: async () => { calls += 1; return successResponse(); }
  }, { circuitBreaker: createSearchCircuitBreaker() });
  assert.equal(result.results[0].ok, true);
  assert.equal(calls, 1);
});
