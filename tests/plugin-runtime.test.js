import test from "node:test";
import assert from "node:assert/strict";
import {
  extractGitHubToolCalls,
  pluginBudgetMessage,
  reserveGitHubToolInferenceBudget,
  shouldOfferGitHubTools
} from "../src/plugin-runtime.js";

test("GitHub tools require explicit repository intent, a signed-in user, and an enabled feature", () => {
  assert.equal(shouldOfferGitHubTools("list my repos", { id: "user-1" }, true), true);
  assert.equal(shouldOfferGitHubTools("show my GitHub issues", { id: "user-1" }, true), true);
  assert.equal(shouldOfferGitHubTools("help me solve this issue", { id: "user-1" }, true), false);
  assert.equal(shouldOfferGitHubTools("list my repos", null, true), false);
  assert.equal(shouldOfferGitHubTools("list my repos", { id: "user-1" }, false), false);
});

test("tool inference budget reserves a conservative cost before connected data is read", async () => {
  const reservations = [];
  const env = {
    BOR_PLUGIN_TOOL_DAILY_USD_LIMIT: "0.10",
    DB: {
      prepare(sql) {
        const statement = {
          sql,
          values: [],
          bind(...values) { this.values = values; return this; },
          async first() { reservations.push({ sql: this.sql, values: this.values }); return { units: this.values[2] }; }
        };
        return statement;
      }
    }
  };
  const result = await reserveGitHubToolInferenceBudget(env, [
    { role: "system", content: "Use authorized tools only." },
    { role: "user", content: "Read a repository file." }
  ], 950, 1);

  assert.equal(result.allowed, true);
  assert.ok(result.reservedMicroUsd > 0);
  assert.ok(result.reservedMicroUsd < 100_000);
  assert.equal(reservations.length, 1);
  assert.match(reservations[0].sql, /daily_usage/);
  assert.equal(reservations[0].values[1], "provider:workers-ai:github-tools:global:micro-usd");
  assert.equal(reservations[0].values[4], 100_000);
});

test("GitHub tool budget fails closed on missing storage, invalid limits, and oversized calls", async () => {
  const messages = [{ role: "user", content: "read file" }];
  assert.equal((await reserveGitHubToolInferenceBudget({}, messages, 950)).allowed, false);
  assert.equal((await reserveGitHubToolInferenceBudget({ DB: {}, BOR_PLUGIN_TOOL_DAILY_USD_LIMIT: "0" }, messages, 950)).allowed, false);
  assert.equal((await reserveGitHubToolInferenceBudget({ DB: {}, BOR_PLUGIN_TOOL_DAILY_USD_LIMIT: "2" }, messages, 950)).allowed, false);
  assert.equal((await reserveGitHubToolInferenceBudget({ DB: {}, BOR_PLUGIN_TOOL_DAILY_USD_LIMIT: "0.10" }, messages, 950, 3)).allowed, false);
  assert.equal((await reserveGitHubToolInferenceBudget({ DB: {}, BOR_PLUGIN_TOOL_DAILY_USD_LIMIT: "0.10" }, [{ role: "user", content: "x".repeat(80_000) }], 950)).allowed, false);
});

test("tool calls are read from Workers AI and OpenAI-compatible response envelopes", () => {
  const calls = [{ name: "list_github_repositories", arguments: {} }];
  assert.deepEqual(extractGitHubToolCalls({ tool_calls: calls }), calls);
  assert.deepEqual(extractGitHubToolCalls({ choices: [{ message: { tool_calls: calls } }] }), calls);
  assert.deepEqual(extractGitHubToolCalls({}), []);
});

test("plugin budget notices follow BOR AI's selected response language", () => {
  assert.match(pluginBudgetMessage("id"), /batas biaya plugin harian/);
  assert.match(pluginBudgetMessage("en"), /daily plugin budget/);
  assert.match(pluginBudgetMessage("unsupported"), /daily plugin budget/);
});
