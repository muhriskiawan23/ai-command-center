import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MODEL_ID } from "../src/model-gateway.js";
import { withTextInferenceBudget } from "../src/text-inference-budget.js";

const payload = { messages: [{ role: "user", content: "Hello" }], max_tokens: 200 };

test("concurrent calls share one budget and ambiguous failures retain their reservation", async () => {
  let total = 0;
  let calls = 0;
  const env = withTextInferenceBudget({
    BOR_TEXT_AI_DAILY_USD_LIMIT: "0.006",
    DB: { prepare: () => ({ bind: (day, subject, reserved, timestamp, limit) => ({
      async first() {
        assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(subject, "provider:workers-ai:text:global:micro-usd");
        if (total + reserved > limit) return null;
        total += reserved;
        return { units: total };
      }
    }) }) },
    AI: { async run() { calls++; throw new Error("ambiguous provider failure"); } }
  });
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => env.AI.run(DEFAULT_MODEL_ID, payload))
  );
  assert.equal(calls, 2);
  assert.equal(results.filter(result => result.reason?.reason === "exhausted").length, 8);
});

test("missing storage or invalid settings block metered text calls", async () => {
  const AI = { run() { assert.fail("provider should not be called"); } };
  for (const limit of ["invalid", "1.00"]) {
    const env = withTextInferenceBudget({ AI, BOR_TEXT_AI_DAILY_USD_LIMIT: limit });
    await assert.rejects(env.AI.run(DEFAULT_MODEL_ID, payload), { reason: "unavailable" });
  }
});
