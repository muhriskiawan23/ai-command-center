import test from "node:test";
import assert from "node:assert/strict";
import { startHarness } from "./e2e/harness.js";

test("chat routes through the adaptive gateway and reports the actual selected model", async () => {
  const app = await startHarness();
  try {
    const response = await fetch(app.url + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: app.url },
      body: JSON.stringify({ message: "Halo BOR AI" })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    assert.deepEqual(body.modelsUsed, [{
      provider: "cloudflare-workers-ai",
      modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      adapter: "workers-ai"
    }]);
    assert.equal(body.agentModels.length, 1);
    assert.equal(body.agentModels[0].agentId, "coordinator");
    assert.equal(body.agentModels[0].taskProfile, "fast_chat");
    assert.equal(body.agentModels[0].calls, 1);
    assert.equal(body.agentModels[0].outcome, "success");
    assert.equal(body.agentModels[0].retryCount, 0);
    assert.equal(typeof body.agentModels[0].durationMs, "number");
    assert.ok(body.agentModels[0].durationMs >= 0);
    assert.equal(app.aiCalls.length, 1);
    assert.deepEqual(app.aiModelCalls, ["@cf/meta/llama-3.3-70b-instruct-fp8-fast"]);
  } finally {
    await app.close();
  }
});

test("multi-agent chat records the selected model for every specialist call", async () => {
  const app = await startHarness();
  try {
    const response = await fetch(app.url + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: app.url },
      body: JSON.stringify({ message: "Buat analisis risiko investasi secara menyeluruh." })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.agentModels));
    assert.ok(body.agentModels.some((item) => item.agentId === "researcher" && item.taskProfile === "research_synthesis"));
    assert.ok(body.agentModels.some((item) => item.agentId === "analyst" && item.taskProfile === "deep_reasoning"));
    assert.ok(body.agentModels.some((item) => item.agentId === "writer" && item.taskProfile === "deep_reasoning"));
    assert.equal(body.modelsUsed.length, 1);
    assert.equal(body.model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    assert.ok(body.agentModels.every((item) => item.outcome === "success"));
    assert.ok(body.agentModels.every((item) => Number.isFinite(item.durationMs) && item.durationMs >= 0));
    assert.ok(body.agentModels.every((item) => item.retryCount >= 0));
    assert.ok(app.aiModelCalls.length >= 3);
    assert.ok(app.aiModelCalls.every((model) => model === "@cf/meta/llama-3.3-70b-instruct-fp8-fast"));
  } finally {
    await app.close();
  }
});
