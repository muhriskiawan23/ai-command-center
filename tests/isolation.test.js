// Isolasi data & sesi diuji terhadap SQLite sungguhan (skema dari migrations/), bukan mock D1.
import test from "node:test";
import assert from "node:assert/strict";
import { startHarness, seedSession, seedConversation } from "./e2e/harness.js";

const ALICE = { id: "sub-alice", email: "alice@example.com" };
const BOB = { id: "sub-bob", email: "bob@example.com" };

async function setup() {
  const app = await startHarness();
  const alice = seedSession(app.db, ALICE);
  const bob = seedSession(app.db, BOB);
  seedConversation(app.db, { id: "conv-alice-0001", userId: ALICE.id, title: "Alice 1", updatedAt: 100, messages: [{ role: "user", content: "a-secret" }, { role: "assistant", content: "ok" }] });
  seedConversation(app.db, { id: "conv-bob-000001", userId: BOB.id, title: "Bob 1", updatedAt: 200, messages: [{ role: "user", content: "b-secret" }, { role: "assistant", content: "ok" }] });
  const call = (token, path, init = {}) => fetch(app.url + path, {
    ...init,
    headers: { "Content-Type": "application/json", Origin: app.url, ...(token ? { Cookie: `__Host-borai_session=${token}` } : {}), ...(init.headers || {}) }
  });
  return { app, alice, bob, call };
}
const count = (app, sql, ...v) => app.db.sqlite.prepare(sql).get(...v).n;

test("guest tidak bisa membaca atau menghapus riwayat", async () => {
  const { app, call } = await setup();
  assert.equal((await call(null, "/api/conversations")).status, 401);
  assert.equal((await call(null, "/api/conversations/conv-alice-0001")).status, 401);
  assert.equal((await call(null, "/api/conversations", { method: "DELETE" })).status, 401);
  assert.equal(count(app, "SELECT COUNT(*) n FROM conversations"), 2);
  await app.close();
});

test("user A tidak bisa membaca, menghapus, atau menulis ke percakapan user B", async () => {
  const { app, alice, call } = await setup();
  assert.equal((await call(alice, "/api/conversations/conv-bob-000001")).status, 404);
  assert.equal((await call(alice, "/api/conversations/conv-bob-000001", { method: "DELETE" })).status, 404);
  const write = await call(alice, "/api/chat", { method: "POST", body: JSON.stringify({ message: "halo dari alice", conversationId: "conv-bob-000001" }) });
  assert.ok([403, 404].includes(write.status), `status tak terduga ${write.status}`);
  assert.equal(count(app, "SELECT COUNT(*) n FROM messages WHERE conversation_id = ?", "conv-bob-000001"), 2);
  assert.equal(count(app, "SELECT COUNT(*) n FROM messages WHERE content LIKE '%halo dari alice%'"), 0);
  const list = await (await call(alice, "/api/conversations")).json();
  assert.deepEqual(list.conversations.map((c) => c.id), ["conv-alice-0001"]);
  await app.close();
});

test("hapus semua riwayat hanya menghapus milik pemanggil; pesan ikut terhapus (cascade FK nyata)", async () => {
  const { app, alice, call } = await setup();
  assert.equal((await call(alice, "/api/conversations", { method: "DELETE" })).status, 200);
  assert.equal(count(app, "SELECT COUNT(*) n FROM conversations WHERE user_id = ?", ALICE.id), 0);
  assert.equal(count(app, "SELECT COUNT(*) n FROM messages WHERE user_id = ?", ALICE.id), 0);
  assert.equal(count(app, "SELECT COUNT(*) n FROM conversations WHERE user_id = ?", BOB.id), 1);
  assert.equal(count(app, "SELECT COUNT(*) n FROM messages WHERE user_id = ?", BOB.id), 2);
  await app.close();
});

test("chat user login tersimpan di akunnya; urutan daftar terbaru dulu", async () => {
  const { app, alice, call } = await setup();
  const res = await call(alice, "/api/chat", { method: "POST", body: JSON.stringify({ message: "Halo" }) });
  const body = await res.json();
  assert.equal(res.status, 200); assert.equal(body.saved, true);
  const list = (await (await call(alice, "/api/conversations")).json()).conversations;
  assert.equal(list[0].id, body.conversationId);
  assert.ok(list[0].updated_at >= list[1].updated_at);
  await app.close();
});

test("mutasi lintas-origin ditolak meski cookie sesi valid (CSRF)", async () => {
  const { app, alice, call } = await setup();
  const evil = { headers: { Origin: "https://evil.example" } };
  assert.equal((await call(alice, "/api/conversations/conv-alice-0001", { method: "DELETE", ...evil })).status, 403);
  assert.equal((await call(alice, "/api/conversations", { method: "DELETE", ...evil })).status, 403);
  assert.equal((await call(alice, "/api/auth/logout", { method: "POST", ...evil })).status, 403);
  assert.equal(count(app, "SELECT COUNT(*) n FROM conversations WHERE user_id = ?", ALICE.id), 1);
  await app.close();
});

test("sesi kedaluwarsa atau sudah logout tidak lagi memberi akses", async () => {
  const { app, alice, call } = await setup();
  app.db.sqlite.prepare("UPDATE sessions SET expires_at = ? WHERE user_id = ?").run(Math.floor(Date.now() / 1000) - 10, ALICE.id);
  assert.equal((await call(alice, "/api/conversations")).status, 401);
  assert.equal((await (await call(alice, "/api/auth/me")).json()).authenticated, false);
  const bobToken = seedSession(app.db, BOB);
  assert.equal((await call(bobToken, "/api/auth/logout", { method: "POST" })).status, 200);
  assert.equal((await call(bobToken, "/api/conversations")).status, 401);
  await app.close();
});

test("token sesi tidak pernah disimpan mentah di database", async () => {
  const { app, alice } = await setup();
  const rows = app.db.sqlite.prepare("SELECT token_hash FROM sessions").all().map((r) => r.token_hash);
  assert.ok(rows.length > 0 && rows.every((h) => h !== alice && /^[0-9a-f]{64}$/.test(h)));
  await app.close();
});
