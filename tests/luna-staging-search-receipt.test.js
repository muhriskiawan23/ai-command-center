import assert from "node:assert/strict";
import test from "node:test";
import { stagingSearchReceipt } from "../src/luna-staging-search-receipt.js";
const response = Response.json({}, { headers: { "x-request-id": "req_synthetic" } });
const data = { status: "completed", model: "gpt-6-luna", usage: {
  input_tokens: 200, output_tokens: 50, input_tokens_details: { cached_tokens: 10 },
  output_tokens_details: { reasoning_tokens: 5 }
}, output: [{type: "web_search_call"}, {type: "message", content: [{text: "private synthetic body"}]}] };

test("receipt preserves only validated usage, model and request ID", () => {
  const r = stagingSearchReceipt(response, data);
  assert.deepEqual(r, { httpStatus: 200, requestId: "req_synthetic", model: "gpt-6-luna",
    usage: { input: 200, output: 50, cached: 10, reasoning: 5, webCalls: 1 }, completed: true, reconciliationRequired: true });
  assert.ok(!JSON.stringify(r).includes("private synthetic body"));
});
test("missing usage never becomes zero usage", () => {
  assert.equal(stagingSearchReceipt(response, { ...data, usage: undefined }).usage, null);
});
test("invalid token counters and cached subsets are refused", () => {
  for (const u of [{input_tokens: -1, output_tokens: 1}, {input_tokens: 1, output_tokens: 1, input_tokens_details: {cached_tokens: 2}}, {input_tokens: 1, output_tokens: 1.5}]) {
    assert.equal(stagingSearchReceipt(response, {...data, usage: u}).usage, null);
  }
});
test("untrusted request ID or model is not stored", () => {
  const r = stagingSearchReceipt(Response.json({}, {headers: {"x-request-id":"Bearer synthetic"}}), {...data, model:"wrong-model"});
  assert.equal(r.requestId, null); assert.equal(r.model, null);
});
test("failed provider response retains no invented token usage", () => {
  const r = stagingSearchReceipt(new Response(null, {status:429}), null);
  assert.equal(r.httpStatus, 429); assert.equal(r.usage, null); assert.equal(r.completed, false);
});
