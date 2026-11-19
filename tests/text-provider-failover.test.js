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
        assert.equal(reserved, 926);
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
      assert.equal(data.model, "gpt-6-luna");
      assert.equal(data.reasoning_effort, "none");
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

test("Luna backup preserves function tools and tool results for the GitHub read flow", async () => {
  let requestBody;
  let reservedCounter;
  const env = withTextProviderFailover({
    BOR_TEXT_LUNA_PRIMARY: "true",
    BOR_TEXT_BACKUP_ENABLED: "true",
    BOR_TEXT_BACKUP_API_KEY: "fixture-key",
    BOR_TEXT_BACKUP_DAILY_USD_LIMIT: "1.00",
    DB: { prepare: () => ({ bind: (_day, subject, units) => ({
      async first() { reservedCounter = subject; return { units }; }
    }) }) },
    AI: { async run() { throw new Error("Cloudflare should not be called"); } }
  }, async (_url, request) => {
    requestBody = JSON.parse(request.body);
    return Response.json({ choices: [{ message: {
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_123", type: "function", function: { name: "list_github_repositories", arguments: "{}" } }]
    } }] });
  });
  const toolPayload = {
    messages: [{ role: "system", content: "Use explicit tools." }, { role: "user", content: "List my GitHub repos." }],
    max_tokens: 200,
    tools: [{ name: "list_github_repositories", description: "List authorized repositories", parameters: { type: "object", properties: {} } }]
  };

  const generated = await env.AI.run(DEFAULT_MODEL_ID, toolPayload);
  assert.equal(reservedCounter, "provider:openai:backup:text:global:micro-usd");
  assert.equal(requestBody.tools[0].type, "function");
  assert.equal(requestBody.tools[0].function.name, "list_github_repositories");
  assert.equal(requestBody.tool_choice, "auto");
  assert.equal(generated.choices[0].message.tool_calls[0].id, "call_123");

  const followup = {
    ...toolPayload,
    messages: [
      ...toolPayload.messages,
      { role: "assistant", content: null, tool_calls: [{ id: "call_123", type: "function", function: { name: "list_github_repositories", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_123", name: "list_github_repositories", content: JSON.stringify({ untrusted_plugin_result: true, result: [] }) }
    ]
  };
  await env.AI.run(DEFAULT_MODEL_ID, followup);
  assert.equal(requestBody.messages.at(-1).tool_call_id, "call_123");
  assert.equal(requestBody.messages.at(-1).role, "tool");
});

test("Luna-first routing uses Cloudflare when Luna fails or its budget is exhausted", async () => {
  let workersCalls = 0;
  let openAiCalls = 0;
  let lunaStatus = 200;
  let budgetAvailable = true;
  const env = withTextProviderFailover({
    BOR_TEXT_LUNA_PRIMARY: "true",
    BOR_TEXT_BACKUP_ENABLED: "true",
    BOR_TEXT_BACKUP_API_KEY: "fixture-key",
    BOR_TEXT_BACKUP_DAILY_USD_LIMIT: "1.00",
    DB: { prepare: () => ({ bind: () => ({
      first: async () => budgetAvailable ? { units: 924 } : null
    }) }) },
    AI: { async run() { workersCalls++; return { response: "Cloudflare" }; } }
  }, async () => {
    openAiCalls++;
    return Response.json({ choices: [{ message: { content: "Luna" } }] }, { status: lunaStatus });
  });

  assert.equal((await env.AI.run(DEFAULT_MODEL_ID, payload)).response, "Luna");
  assert.equal(workersCalls, 0);
  lunaStatus = 503;
  assert.equal((await env.AI.run(DEFAULT_MODEL_ID, payload)).response, "Cloudflare");
  budgetAvailable = false;
  assert.equal((await env.AI.run(DEFAULT_MODEL_ID, payload)).response, "Cloudflare");
  assert.equal(workersCalls, 2);
  assert.equal(openAiCalls, 2);
});
