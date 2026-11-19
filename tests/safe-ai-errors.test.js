import test from "node:test";
import assert from "node:assert/strict";
import { safeError, safeAiBindingFailure } from "../src/safe-error.js";

test("classifies documented Cloudflare Workers AI errors without leaking provider messages", () => {
  const token = "sensitive-api-key-do-not-log";
  const summary = safeAiBindingFailure({
    name: "ProprietaryProviderError",
    message: "Private prompt and " + token,
    stack: "Sensitive stack",
    cause: { code: 3036, status: 429, message: token }
  });
  assert.deepEqual(summary, {
    category: "daily_ai_allocation_exhausted",
    providerCode: 3036,
    httpStatus: 429
  });
  assert.ok(!JSON.stringify(summary).includes(token));
});

test("handles model/plan/capacity codes and hides unknown numeric codes", () => {
  assert.equal(safeAiBindingFailure({ code: "5035" }).category, "paid_plan_required");
  assert.equal(safeAiBindingFailure({ data: { errors: [{ code: 3040 }] } }).category, "provider_capacity_exceeded");
  assert.equal(safeAiBindingFailure({ response: { errors: [{ code: 5028 }], status: 410 } }).category, "model_deprecated");
  assert.deepEqual(safeAiBindingFailure({ code: "Bearer-secret", status: 201, message: "private" }), {
    category: "provider_error_unclassified", providerCode: null, httpStatus: null
  });
});

test("untrusted error objects cannot inject output into safe AI binding diagnostics", () => {
  const malicious = new Proxy({}, { get() { throw new Error("secret"); } });
  assert.deepEqual(safeAiBindingFailure(malicious), {
    category: "provider_error_unclassified", providerCode: null, httpStatus: null
  });
  assert.deepEqual(safeError({ name: "ProprietaryProviderError", message: "secret" }), { name: "UnknownError" });
});

test("recognizes the Workers AI quota message without relying on the wrapper code", () => {
  const message = "AiError: AiError: you have used up your daily free allocation of 10,000 neurons, please upgrade";
  for (const error of [new Error(message), { errors: [{ code: 4006, message }] }]) {
    assert.deepEqual(safeAiBindingFailure(error), {
      category: "daily_ai_allocation_exhausted", providerCode: null, httpStatus: null
    });
  }
  assert.equal(safeAiBindingFailure({ code: 4006, status: 429 }).category, "provider_error_unclassified");
});
