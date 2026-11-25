import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/luna-staging-worker.js";
import { runLunaStagingEvaluation } from "../src/luna-staging-live-evaluation.js";

const env = () => ({
  BOR_LUNA_LIVE_TRIGGER_DIGEST: "a".repeat(64),
  BOR_LUNA_LIVE_EVAL_ID: "web-v2-expiry-test",
  BOR_LUNA_LIVE_EVAL_EXPIRES_AT: String(Date.now() + 60000),
  BOR_TEXT_BACKUP_API_KEY: "synthetic-key",
  DB: { prepare() { assert.fail("invalid evaluation window must not touch DB"); } }
});
const invalid = () => ["0", "NaN", "Infinity", String(Date.now() - 1000), String(Date.now() + 600000), String(Date.now() + 60000.5)];
const req = () => new Request("https://staging.example/__staging-evaluation");

test("legacy evaluation HTTP route rejects invalid or excessive expiry", async () => {
  for (const expires of invalid()) {
    assert.equal((await worker.fetch(req(), { ...env(), BOR_LUNA_LIVE_EVAL_EXPIRES_AT: expires })).status, 404);
  }
});
test("kill switch disables the legacy evaluation page", async () => {
  assert.equal((await worker.fetch(req(), { ...env(), BOR_WEB_SEARCH_KILL_SWITCH: "true" })).status, 404);
});
test("valid short window allows only the legacy GET page without accessing DB", async () => {
  const response = await worker.fetch(req(), env());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /no-store/);
});
test("direct and scheduled evaluator reject invalid or excessive expiry before DB or provider", async () => {
  for (const expires of invalid()) {
    await runLunaStagingEvaluation({ ...env(), BOR_LUNA_LIVE_EVAL_EXPIRES_AT: expires },
      () => assert.fail("invalid evaluation window must not invoke provider"));
  }
});
