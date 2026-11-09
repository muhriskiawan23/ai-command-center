import test from "node:test";
import assert from "node:assert/strict";
import { startHarness, seedSession, seedConversation } from "./e2e/harness.js";

const ALICE = { id: "sub-alice-feedback", email: "alice@example.com" };
const BOB = { id: "sub-bob-feedback", email: "bob@example.com" };

async function setup() {
  const app = await startHarness();
  const alice = seedSession(app.db, ALICE);
  const bob = seedSession(app.db, BOB);
  seedConversation(app.db, {
    id: "conv-alice-feedback", userId: ALICE.id, title: "Alice", updatedAt: 100,
    messages: [{ role: "user", content: "Pertanyaan Alice" }, { role: "assistant", content: "Jawaban Alice" }]
  });
  seedConversation(app.db, {
    id: "conv-bob-feedback", userId: BOB.id, title: "Bob", updatedAt: 100,
    messages: [{ role: "user", content: "Pertanyaan Bob" }, { role: "assistant", content: "Jawaban Bob" }]
  });
  const call = (token, path, init = {}) => fetch(app.url + path, {
    ...init,
    headers: { "Content-Type": "application/json", Origin: app.url, ...(token ? { Cookie: `__Host-borai_session=${token}` } : {}), ...(init.headers || {}) }
  });
  const aliceResponseId = app.db.sqlite.prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant'").get("conv-alice-feedback").id;
  const aliceUserMessageId = app.db.sqlite.prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'user'").get("conv-alice-feedback").id;
  const bobResponseId = app.db.sqlite.prepare("SELECT id FROM messages WHERE conversation_id = ? AND role = 'assistant'").get("conv-bob-feedback").id;
  return { app, alice, bob, call, aliceResponseId, aliceUserMessageId, bobResponseId };
}

test("feedback tersimpan pada jawaban yang tepat dan dapat diperbarui tanpa duplikasi", async () => {
  const { app, alice, call, aliceResponseId } = await setup();
  const submit = (rating, reason = "") => call(alice, "/api/feedback", {
    method: "POST", body: JSON.stringify({ conversationId: "conv-alice-feedback", responseId: aliceResponseId, rating, reason })
  });
  let response = await submit("not_helpful", "Kurang jelas");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { saved: true, responseId: aliceResponseId, rating: "not_helpful", reason: "Kurang jelas" });
  response = await submit("helpful");
  assert.equal(response.status, 200);
  assert.equal(app.db.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_feedback").get().n, 1);
  const stored = app.db.sqlite.prepare("SELECT user_id, conversation_id, message_id, rating, reason FROM answer_feedback").get();
  assert.deepEqual({ ...stored }, { user_id: ALICE.id, conversation_id: "conv-alice-feedback", message_id: aliceResponseId, rating: "helpful", reason: "" });
  const history = await (await call(alice, "/api/conversations/conv-alice-feedback")).json();
  const answer = history.messages.find((message) => message.id === aliceResponseId);
  assert.deepEqual(answer.feedback, { rating: "helpful", reason: "" });
  await app.close();
});

test("feedback menolak guest, CSRF, pesan user, dan referensi lintas akun", async () => {
  const { app, alice, bob, call, aliceResponseId, aliceUserMessageId, bobResponseId } = await setup();
  const payload = (conversationId, responseId) => JSON.stringify({ conversationId, responseId, rating: "helpful" });
  assert.equal((await call(null, "/api/feedback", { method: "POST", body: payload("conv-alice-feedback", aliceResponseId) })).status, 401);
  assert.equal((await call(alice, "/api/feedback", { method: "POST", headers: { Origin: "https://evil.example" }, body: payload("conv-alice-feedback", aliceResponseId) })).status, 403);
  assert.equal((await call(alice, "/api/feedback", { method: "POST", body: payload("conv-alice-feedback", aliceUserMessageId) })).status, 404);
  assert.equal((await call(bob, "/api/feedback", { method: "POST", body: payload("conv-alice-feedback", aliceResponseId) })).status, 404);
  assert.equal((await call(alice, "/api/feedback", { method: "POST", body: payload("conv-alice-feedback", bobResponseId) })).status, 404);
  assert.equal(app.db.sqlite.prepare("SELECT COUNT(*) AS n FROM answer_feedback").get().n, 0);
  await app.close();
});

test("feedback memvalidasi rating, ukuran alasan, dan method HTTP", async () => {
  const { app, alice, call, aliceResponseId } = await setup();
  const base = { conversationId: "conv-alice-feedback", responseId: aliceResponseId };
  assert.equal((await call(alice, "/api/feedback", { method: "POST", body: JSON.stringify({ ...base, rating: "maybe" }) })).status, 400);
  assert.equal((await call(alice, "/api/feedback", { method: "POST", body: JSON.stringify({ ...base, rating: "not_helpful", reason: "x".repeat(501) }) })).status, 400);
  assert.equal((await call(alice, "/api/feedback", { method: "GET" })).status, 405);
  await app.close();
});
