import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));

test("production URL Reader is OFF until owner-approved rollout", () => {
  assert.equal(config.vars?.URL_READER_ENABLED, "false",
    "Do not enable URL Reader in production without Tavily billing, privacy and security sign-off");
});

test("production config does not silently authorize Tavily extraction spending", () => {
  const limit = config.vars?.TAVILY_EXTRACT_DAILY_URL_LIMIT;
  assert.ok(limit === undefined || limit === null || Number(limit) === 0,
    "Production Tavily paid extraction must remain blocked until explicit owner approval");
});

test("production config does not expose Tavily API keys in plaintext vars", () => {
  assert.equal(Object.hasOwn(config.vars || {}, "TAVILY_API_KEY"), false);
});
