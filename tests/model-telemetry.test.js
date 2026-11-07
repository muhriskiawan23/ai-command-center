import test from "node:test";
import assert from "node:assert/strict";
import { createModelCallTelemetry, emitModelCallTelemetry } from "../src/model-telemetry.js";

const base = {
  requestId: "req-test-1",
  agentId: "coordinator",
  taskProfile: "fast_chat",
  provider: "cloudflare-workers-ai",
  adapter: "workers-ai",
  modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  policyVersion: "adaptive-v1",
  attempt: 1,
  startedAt: 1000,
  finishedAt: 1245
};

test("model telemetry records safe success metadata and normalized token usage", () => {
  const event = createModelCallTelemetry({
    ...base,
    outcome: "success",
    result: {
      response: "PRIVATE GENERATED CONTENT MUST NOT BE LOGGED",
      usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165 }
    }
  });
  assert.equal(event.event, "borai.model_call");
  assert.equal(event.latencyMs, 245);
  assert.equal(event.promptTokens, 120);
  assert.equal(event.completionTokens, 45);
  assert.equal(event.totalTokens, 165);
  assert.equal(event.outcome, "success");
  assert.equal(JSON.stringify(event).includes("PRIVATE GENERATED CONTENT"), false);
});

test("model telemetry records only a sanitized error class, never the error message", () => {
  const event = createModelCallTelemetry({
    ...base,
    outcome: "error",
    error: Object.assign(new Error("contains private prompt data"), { name: "Provider.Error/Unsafe" })
  });
  assert.equal(event.outcome, "error");
  assert.equal(event.errorType, "Provider.ErrorUnsafe");
  assert.equal(JSON.stringify(event).includes("private prompt data"), false);
});

test("telemetry logger failures never affect model execution", () => {
  assert.doesNotThrow(() => emitModelCallTelemetry({ event: "borai.model_call" }, () => {
    throw new Error("logger unavailable");
  }));
  assert.doesNotThrow(() => emitModelCallTelemetry({ event: "borai.model_call" }, null));
});
