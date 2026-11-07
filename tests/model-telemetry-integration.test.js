import test from "node:test";
import assert from "node:assert/strict";
import { startHarness } from "./e2e/harness.js";

test("chat emits privacy-safe model-call telemetry with one request correlation ID", async () => {
  const events = [];
  const app = await startHarness({
    extraEnv: { MODEL_TELEMETRY_LOGGER: event => events.push(event) }
  });
  try {
    const response = await fetch(app.url + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: app.url },
      body: JSON.stringify({ message: "Halo BOR AI, jelaskan fungsi utama kamu." })
    });
    assert.equal(response.status, 200);
    assert.equal(events.length, 1);
    const event = events[0];
    assert.equal(event.event, "borai.model_call");
    assert.equal(event.outcome, "success");
    assert.equal(event.agentId, "coordinator");
    assert.equal(event.taskProfile, "fast_chat");
    assert.equal(event.modelId, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    assert.equal(typeof event.requestId, "string");
    assert.ok(event.requestId.length >= 16);
    assert.ok(Number.isFinite(event.latencyMs) && event.latencyMs >= 0);
    const serialized = JSON.stringify(event);
    assert.equal(serialized.includes("Halo BOR AI"), false);
    assert.equal(serialized.includes("response"), false);
    assert.equal(serialized.includes("messages"), false);
  } finally {
    await app.close();
  }
});
