import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("owner-requested production reader uses managed Tavily with narrow shared budget", () => {
  assert.equal(config.vars?.URL_READER_ENABLED, "true");
  assert.equal(config.vars?.URL_READER_PROVIDER, "tavily");
  assert.equal(config.vars?.SEARCH_PROVIDER, "tavily");
  assert.equal(config.vars?.SEARCH_SHARED_BUDGET_ENABLED, "true");
  assert.ok(Number.isInteger(Number(config.vars?.SEARCH_DAILY_ATTEMPT_LIMIT_TAVILY)));
  assert.ok(Number(config.vars?.SEARCH_DAILY_ATTEMPT_LIMIT_TAVILY)>0 && Number(config.vars?.SEARCH_DAILY_ATTEMPT_LIMIT_TAVILY)<=12);
});

test("production Tavily extraction has an explicit eight-URL global daily ceiling", () => {
  const limit = Number(config.vars?.TAVILY_EXTRACT_DAILY_URL_LIMIT);
  assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= 8,
    "Tavily paid extraction must have a narrow positive global daily ceiling");
});

test("production config does not expose Tavily API keys in plaintext vars", () => {
  assert.equal(Object.hasOwn(config.vars || {}, "TAVILY_API_KEY"), false);
});
