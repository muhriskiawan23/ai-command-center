import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("production keeps Tavily Search on but fails closed for unverified URL reading", () => {
  assert.equal(config.vars?.URL_READER_ENABLED, "false");
  assert.equal(config.vars?.URL_READER_PROVIDER, "tavily");
  assert.equal(config.vars?.SEARCH_PROVIDER, "tavily");
  assert.equal(config.vars?.SEARCH_SHARED_BUDGET_ENABLED, "true");
  assert.ok(Number.isInteger(Number(config.vars?.SEARCH_DAILY_ATTEMPT_LIMIT_TAVILY)));
  assert.ok(Number(config.vars?.SEARCH_DAILY_ATTEMPT_LIMIT_TAVILY)>0 && Number(config.vars?.SEARCH_DAILY_ATTEMPT_LIMIT_TAVILY)<=12);
});

test("production Tavily extraction is disabled until vendor privacy and SSRF gates pass", () => {
  const limit = Number(config.vars?.TAVILY_EXTRACT_DAILY_URL_LIMIT);
  assert.equal(limit, 0, "Unverified Tavily extraction must consume zero daily URLs");
});

test("production config does not expose Tavily API keys in plaintext vars", () => {
  assert.equal(Object.hasOwn(config.vars || {}, "TAVILY_API_KEY"), false);
});
