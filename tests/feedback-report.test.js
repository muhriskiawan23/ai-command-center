import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createD1, seedSession, seedConversation } from "./e2e/harness.js";

const origin = "https://bor.example";
function openReport(env, token, path = "/internal/feedback", method = "GET") {
  const headers = token ? { Cookie: "__Host-borai_session=" + token } : {};
  return worker.fetch(new Request(origin + path, { method, headers }), env);
}

function setup(t) {
  const DB = createD1();
  t.after(() => DB.sqlite.close());
  const ownerId = "report-owner";
  const testerId = "report-tester";
  const owner = seedSession(DB, { id: ownerId, email: "owner@example.invalid" });
  const tester = seedSession(DB, { id: testerId, email: "tester@example.invalid" });
  return { env: { DB, BOR_FEEDBACK_REPORT_OWNER_ID: ownerId }, owner, tester, testerId };
}

test("feedback report is disabled by default and checks the configured owner's session each time", async t => {
  const { env, owner, tester } = setup(t);
  const disabled = await openReport({ DB: env.DB }, owner);
  const guest = await openReport(env);
  const other = await openReport(env, tester, "/internal/feedback?ownerId=report-owner");
  for (const response of [disabled, guest, other]) {
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  const otherMethod = await openReport(env, owner, "/internal/feedback", "POST");
  assert.equal(otherMethod.status, 405);
  assert.equal(otherMethod.headers.get("Allow"), "GET");
  env.DB.sqlite.prepare("UPDATE sessions SET expires_at = 0").run();
  assert.equal((await openReport(env, owner)).status, 404);
});

test("feedback report shows bounded aggregate periods without exposing the user's text or identity", async t => {
  const { env, owner, testerId } = setup(t);
  const now = Math.floor(Date.now() / 1000);
  const id = "conv-report-tester";
  const hiddenReason = "<script>private feedback</script>";
  seedConversation(env.DB, {
    id, userId: testerId, title: "private conversation", updatedAt: now,
    messages: ["private answer one", "private answer two", "private answer three", "private answer four"].map(content => ({ role: "assistant", content }))
  });
  const messages = env.DB.sqlite.prepare("SELECT id FROM messages WHERE conversation_id = ? ORDER BY id").all(id);
  const insert = env.DB.sqlite.prepare("INSERT INTO answer_feedback (user_id, conversation_id, message_id, rating, reason, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const [i, [rating, reason, age]] of [
    ["helpful", "", 1], ["not_helpful", hiddenReason, 2], ["not_helpful", "", 10], ["helpful", "", 40]
  ].entries()) {
    const updatedAt = now - age * 86400;
    insert.run(testerId, id, messages[i].id, rating, reason, updatedAt, updatedAt);
  }
  const week = await openReport(env, owner);
  const month = await openReport(env, owner, "/internal/feedback?days=30");
  for (const response of [week, month]) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
    assert.match(response.headers.get("Content-Security-Policy"), /frame-ancestors 'none'/);
  }
  const weekText = await week.text();
  const monthText = await month.text();
  assert.match(weekText, /Total penilaian<\/th><td>2<\/td>/);
  assert.match(weekText, /penilaian membantu<\/th><td>50/);
  assert.match(monthText, /Total penilaian<\/th><td>3<\/td>/);
  assert.match(monthText, /Tidak membantu<\/th><td>2<\/td>/);
  assert.match(monthText, /Tidak membantu, dengan alasan<\/th><td>1<\/td>/);
  assert.doesNotMatch(weekText + monthText, /private|report-tester|tester@example/);
  env.DB.sqlite.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  const empty = await (await openReport(env, owner)).text();
  assert.match(empty, /Total penilaian<\/th><td>0<\/td>/);
  assert.match(empty, /penilaian membantu<\/th><td>—<\/td>/);
});
