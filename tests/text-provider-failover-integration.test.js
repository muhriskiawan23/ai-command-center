import assert from "node:assert/strict";
import test from "node:test";
import { BACKUP_MODEL } from "../src/text-provider-failover.js";
import { seedSession, startHarness } from "./e2e/harness.js";

test("chat recovers through backup after both providers fail without double-counting a retry", async (t) => {
  const app = await startHarness({ extraEnv: {
    BOR_TEXT_AI_DAILY_USD_LIMIT: "1.00",
    BOR_TEXT_BACKUP_ENABLED: "true",
    BOR_TEXT_BACKUP_API_KEY: "synthetic-test-key",
    BOR_TEXT_BACKUP_DAILY_USD_LIMIT: "1.00"
  } });
  t.after(() => app.close());
  const user = { id: "failover-test", email: "failover@example.test", name: "Tester" };
  const token = seedSession(app.db, user);
  let primaryCalls = 0;
  app.env.AI.run = async () => {
    primaryCalls++;
    throw Object.assign(new Error("synthetic capacity failure"), { code: 3040, status: 429 });
  };

  let backupAvailable = false;
  let backupCalls = 0;
  const clientFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.openai.com/v1/chat/completions");
    assert.equal(JSON.parse(options.body).store, false);
    backupCalls++;
    return backupAvailable
      ? Response.json({ choices: [{ message: { content: "Halo!" } }] })
      : Response.json({}, { status: 503 });
  });

  const requestId = crypto.randomUUID();
  const post = () => clientFetch(app.url + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.url, Cookie: "__Host-borai_session=" + token },
    body: JSON.stringify({ message: "hi bor", requestId, language: "id" })
  });
  const units = subject => app.db.sqlite.prepare("SELECT units FROM daily_usage WHERE subject = ?").get(subject)?.units;

  const failed = await post();
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).code, "ai_error");
  assert.equal(units("user:" + user.id), 0);
  assert.equal(units("global"), 0);
  assert.ok(units("provider:openai:backup:text:global:micro-usd") > 0);

  backupAvailable = true;
  const recovered = await post();
  assert.equal(recovered.status, 200);
  const answer = await recovered.json();
  assert.equal(answer.response, "Halo!");
  assert.equal(answer.model, BACKUP_MODEL);
  assert.equal(answer.agentModels[0].provider, "openai");
  assert.ok(answer.conversationId);

  const replay = await post();
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).conversationId, answer.conversationId);
  assert.equal(primaryCalls, 2);
  assert.equal(backupCalls, 2);
  assert.equal(units("user:" + user.id), 1);
  assert.equal(units("global"), 1);
});
