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
      body: JSON.stringify({ message: "Buat analisis risiko investasi secara menyeluruh. Jangan masukkan prompt ini ke telemetry." })
    });
    assert.equal(response.status, 200);
    const events = captured.map(args => args[0]).filter(value =>
      value && typeof value === "object" && value.event === "BOR_AI_MODEL_TELEMETRY"
    );
    assert.ok(events.length >= 3, "multi-agent calls should emit one event per specialist");
    assert.ok(events.some(event => event.agentId === "researcher"));
    assert.ok(events.every(event => event.schemaVersion === 1));
    assert.ok(events.every(event => event.outcome === "success"));
    assert.ok(events.every(event => typeof event.requestId === "string" && event.requestId.length >= 16));
    assert.equal(new Set(events.map(event => event.requestId)).size, 1, "all specialist events must share one request ID");
    assert.ok(events.every(event => Number.isFinite(event.durationMs) && event.durationMs >= 0));
    assert.ok(events.every(event => event.retryCount >= 0));
    const serialized = JSON.stringify(events);
    assert.equal(serialized.includes("Jangan masukkan prompt ini"), false);
    assert.equal(serialized.includes("prompt"), false);
    assert.equal(serialized.includes("response"), false);
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
