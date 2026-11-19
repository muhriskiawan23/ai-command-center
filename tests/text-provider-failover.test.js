import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MODEL_ID } from "../src/model-gateway.js";
import { withTextProviderFailover } from "../src/text-provider-failover.js";

const payload = { messages: [{ role: "user", content: "Synthetic greeting" }], max_tokens: 200 };
const quota = new Error("AiError: you have used up your daily free allocation of 10,000 neurons");

function fixture(error = quota, settings = {}) {
  let sends = 0;
  const env = {
    BOR_TEXT_BACKUP_ENABLED: "true",
    BOR_TEXT_BACKUP_API_KEY: "fixture-key",
    BOR_TEXT_BACKUP_DAILY_USD_LIMIT: "1.00",
    DB: { prepare: () => ({ bind: (day, key, reserved) => ({
      async first() {
        assert.equal(key, "provider:openai:backup:text:global:micro-usd");
        assert.ok(reserved > 0);
        return { units: reserved };
      }
    }) }) },
    AI: { async run() { throw error; } },
    ...settings
  };
  return {
    env: withTextProviderFailover(env, async (url, request) => {
      sends++;
      assert.equal(url, "https://api.openai.com/v1/chat/completions");
      assert.equal(request.redirect, "manual");
      const data = JSON.parse(request.body);
      assert.equal(data.store, false);
      assert.equal(data.max_completion_tokens, payload.max_tokens);
      return Response.json({ choices: [{ message: { content: "Hello" } }] });
    }),
    sends: () => sends
  };
}

test("quota failure activates exactly one independently metered fallback per request", async () => {
  const { env, sends } = fixture();
  const results = await Promise.allSettled([
    env.AI.run(DEFAULT_MODEL_ID, payload),
    env.AI.run(DEFAULT_MODEL_ID, payload)
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  assert.equal(sends(), 1);
  assert.equal(results.find(result => result.status === "fulfilled").value.response, "Hello");
});

test("disabled configuration, input errors, and exhausted budgets never contact backup", async () => {
  for (const [error, settings] of [
    [quota, { BOR_TEXT_BACKUP_ENABLED: "false" }],
    [Object.assign(new Error("bad input"), { status: 400 }), {}],
    [quota, { BOR_TEXT_BACKUP_DAILY_USD_LIMIT: "0.000001" }]
  ]) {
    const { env, sends } = fixture(error, settings);
    await assert.rejects(env.AI.run(DEFAULT_MODEL_ID, payload), error);
    assert.equal(sends(), 0);
  }
});

test("cancelled and image-like calls never contact backup", async () => {
  const { env, sends } = fixture();
  await assert.rejects(env.AI.run(DEFAULT_MODEL_ID, payload, { signal: AbortSignal.abort() }), quota);
  await assert.rejects(env.AI.run(DEFAULT_MODEL_ID, { image: [] }), quota);
  assert.equal(sends(), 0);
});
