import test from "node:test";
import assert from "node:assert/strict";
import { startHarness, seedSession } from "./e2e/harness.js";

test("membuka percakapan sangat panjang mengembalikan 500 pesan terbaru (urut lama→baru) dan menandai truncated", async () => {
  const app = await startHarness();
  const token = seedSession(app.db, { id: "u1", email: "a@b.c" });
  const now = Math.floor(Date.now() / 1000);
  app.db.sqlite.prepare("INSERT INTO conversations (id,user_id,title,created_at,updated_at) VALUES ('conv-panjang-01','u1','Panjang',?,?)").run(now, now);
  const ins = app.db.sqlite.prepare("INSERT INTO messages (conversation_id,user_id,role,content,created_at) VALUES ('conv-panjang-01','u1',?,?,?)");
  app.db.sqlite.exec("BEGIN");
  for (let i = 1; i <= 1200; i++) ins.run(i % 2 ? "user" : "assistant", `pesan-${i}`, now);
  app.db.sqlite.exec("COMMIT");
  const res = await fetch(app.url + "/api/conversations/conv-panjang-01", { headers: { Cookie: `__Host-borai_session=${token}` } });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.messages.length, 500);
  assert.equal(body.truncated, true);
  assert.equal(body.messages[0].content, "pesan-701");      // 500 terbaru, mulai dari yang paling lama di antaranya
  assert.equal(body.messages.at(-1).content, "pesan-1200");
  await app.close();
});

test("percakapan pendek: semua pesan kembali, urut benar, truncated=false", async () => {
  const app = await startHarness();
  const token = seedSession(app.db, { id: "u1", email: "a@b.c" });
  const first = await (await fetch(app.url + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: app.url, Cookie: `__Host-borai_session=${token}` }, body: JSON.stringify({ message: "satu" }) })).json();
  const body = await (await fetch(app.url + "/api/conversations/" + first.conversationId, { headers: { Cookie: `__Host-borai_session=${token}` } })).json();
  assert.deepEqual(body.messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(body.messages[0].content, "satu");
  assert.equal(body.truncated, false);
  await app.close();
});
