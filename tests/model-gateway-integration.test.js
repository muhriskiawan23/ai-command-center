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


test("emits structured privacy-safe telemetry with a shared request correlation ID", async () => {
  const app = await startHarness();
  const captured = [];
  const originalLog = console.log;
  console.log = (...args) => captured.push(args);
  try {
    const response = await fetch(app.url + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: app.url },
      body: JSON.stringify({ message: "Pesan uji yang tidak boleh masuk ke log telemetry." })
    });
    assert.equal(response.status, 200);
    const event = captured.map(args => args[0]).find(value =>
      value && typeof value === "object" && value.event === "BOR_AI_MODEL_TELEMETRY"
    );
    assert.ok(event, "structured model telemetry event should be emitted");
    assert.equal(event.schemaVersion, 1);
    assert.equal(event.agentId, "coordinator");
    assert.equal(event.outcome, "success");
    assert.equal(typeof event.requestId, "string");
    assert.ok(event.requestId.length >= 16);
    assert.ok(Number.isFinite(event.durationMs) && event.durationMs >= 0);
    assert.equal(event.retryCount, 0);
    assert.equal(JSON.stringify(event).includes("Pesan uji"), false);
    assert.equal(Object.hasOwn(event, "prompt"), false);
    assert.equal(Object.hasOwn(event, "response"), false);
  } finally {
    console.log = originalLog;
    await app.close();
  }
});

test("telemetry logging failures do not turn successful model responses into errors", async () => {
  const app = await startHarness();
  const originalLog = console.log;
  console.log = () => { throw new Error("log sink unavailable"); };
  try {
    const response = await fetch(app.url + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: app.url },
      body: JSON.stringify({ message: "Halo BOR AI" })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(typeof body.response, "string");
    assert.ok(body.response.length > 0);
  } finally {
    console.log = originalLog;
    await app.close();
  }
});
