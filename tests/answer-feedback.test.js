import test from "node:test";
import assert from "node:assert/strict";
import { startHarness, seedSession, seedConversation } from "./e2e/harness.js";
const ALICE = { id: "feedback-alice", email: "alice@example.com" };
const BOB = { id: "feedback-bob", email: "bob@example.com" };
async function setup() {
  const app = await startHarness();
  const alice = seedSession(app.db, ALICE), bob = seedSession(app.db, BOB);
  seedConversation(app.db, { id: "feedback-chat-a", userId: ALICE.id, title: "Alice chat", updatedAt: 100, messages: [{ role: "user", content: "Pertanyaan Alice" }, { role: "assistant", content: "Jawaban Alice" }] });
  seedConversation(app.db, { id: "feedback-chat-b", userId: BOB.id, title: "Bob chat", updatedAt: 100, messages: [{ role: "user", content: "Pertanyaan Bob" }, { role: "assistant", content: "Jawaban Bob" }] });
  const ids = {
    aliceUser: app.db.sqlite.prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'user'").get("feedback-chat-a").id,
    aliceAnswer: app.db.sqlite.prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant'").get("feedback-chat-a").id,
    bobAnswer: app.db.sqlite.prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant'").get("feedback-chat-b").id
  };
  const call = (token, body, origin = app.url) => fetch(app.url + "/api/feedback", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(token ? { Cookie: `__Host-borai_session=${token}` } : {}) }, body: JSON.stringify(body)
  });
  return { app, alice, bob, ids, call };
}
test("feedback tersimpan per jawaban dan dapat diperbarui tanpa membuat duplikat", async () => {
  const { app, alice, ids, call } = await setup();
  const first = await call(alice, { conversationId: "feedback-chat-a", responseId: ids.aliceAnswer, rating: "helpful" });
  assert.equal(first.status, 200); assert.equal((await first.json()).saved, true);
  const updated = await call(alice, { conversationId: "feedback-chat-a", responseId: ids.aliceAnswer, rating: "not_helpful", reason: "Jawaban kurang lengkap" });
  assert.equal(updated.status, 200);
  const stored = app.db.sqlite.prepare("SELECT user_id, conversation_id, message_id, rating, reason FROM answer_feedback").get();
  assert.deepEqual({ ...stored }, {
    user_id: ALICE.id, conversation_id: "feedback-chat-a", message_id: ids.aliceAnswer, rating: "not_helpful", reason: "Jawaban kurang lengkap"
  });
  assert.equal(app.db.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_feedback").get().n, 1);
  await app.close();
});
test("feedback tidak dapat dibuat lintas akun atau untuk pesan user", async () => {
  const { app, alice, bob, ids, call } = await setup();
  assert.equal((await call(bob, { conversationId: "feedback-chat-a", responseId: ids.aliceAnswer, rating: "helpful" })).status, 404);
  assert.equal((await call(alice, { conversationId: "feedback-chat-b", responseId: ids.bobAnswer, rating: "helpful" })).status, 404);
  assert.equal((await call(alice, { conversationId: "feedback-chat-a", responseId: ids.aliceUser, rating: "helpful" })).status, 404);
  assert.equal(app.db.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_feedback").get().n, 0);
  await app.close();
});
test("feedback requires a signed-in same-origin request and validates its payload", async () => {
  const { app, alice, ids, call } = await setup();
  assert.equal((await call(null, { conversationId: "feedback-chat-a", responseId: ids.aliceAnswer, rating: "helpful" })).status, 401);
  assert.equal((await call(alice, { conversationId: "feedback-chat-a", responseId: ids.aliceAnswer, rating: "neutral" })).status, 400);
  assert.equal((await call(alice, { conversationId: "feedback-chat-a", responseId: ids.aliceAnswer, rating: "not_helpful", reason: "x".repeat(501) })).status, 400);
  assert.equal((await call(alice, { conversationId: "feedback-chat-a", responseId: ids.aliceAnswer, rating: "helpful" }, "https://evil.example")).status, 403);
  assert.equal(app.db.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_feedback").get().n, 0);
  await app.close();
});
