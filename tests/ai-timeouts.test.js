// Batas waktu server untuk panggilan model (temuan M5): panggilan macet dan rantai multi-agent yang terlalu lama.
import test from "node:test";
import assert from "node:assert/strict";
import { startHarness, seedSession } from "./e2e/harness.js";

const MULTI = "Buat rencana promosi dan analisis risiko untuk usaha saya, tanpa modal.";

async function setup(options = {}) {
  const app = await startHarness(options);
  const post = (message, { cookie } = {}) => fetch(app.url + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.url, ...(cookie ? { Cookie: `__Host-borai_session=${cookie}` } : {}) },
    body: JSON.stringify({ message })
  });
  const usage = () => Object.fromEntries(app.db.sqlite.prepare("SELECT subject, units FROM daily_usage").all().map((r) => [r.subject.startsWith("guest:") ? "guest" : r.subject, r.units]));
  return { app, post, usage };
}

test("panggilan model yang menggantung dibatalkan: 504 cepat dengan pesan jelas, bukan menunggu selamanya", async () => {
  const { app, post } = await setup({ extraEnv: { AI_CALL_TIMEOUT_MS: "120" } });
  app.control.aiHang = true;
  const started = Date.now();
  const res = await post("halo");
  const body = await res.json();
  assert.equal(res.status, 504);
  assert.equal(body.code, "ai_timeout");
  assert.match(body.error, /terlalu lama merespons/);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 100 && elapsed < 3000, `butuh ${elapsed} ms`);               // benar-benar menunggu batas per panggilan (bukan ditolak di awal)
  await app.close();
});

test("timeout mengembalikan jatah harian dan tidak menyimpan apa pun untuk akun login", async () => {
  const { app, post, usage } = await setup({ extraEnv: { AI_CALL_TIMEOUT_MS: "100" } });
  const token = seedSession(app.db, { id: "u1", email: "a@b.c" });
  app.control.aiHang = true;
  assert.equal((await post("halo", { cookie: token })).status, 504);
  assert.equal(usage()["user:u1"], 0);
  assert.equal(usage().global, 0);
  assert.equal(app.db.sqlite.prepare("SELECT COUNT(*) n FROM messages").get().n, 0);
  assert.equal(app.db.sqlite.prepare("SELECT COUNT(*) n FROM conversations").get().n, 0);
  app.control.aiHang = false;
  assert.equal((await post("halo lagi", { cookie: token })).status, 200);       // pulih normal setelah itu
  await app.close();
});

test("jalur normal tidak terpengaruh, dan nilai env yang tidak valid memakai default", async () => {
  const { app, post } = await setup({ extraEnv: { AI_CALL_TIMEOUT_MS: "abc", AI_TOTAL_BUDGET_MS: "-5" } });
  assert.equal((await post("halo")).status, 200);
  assert.equal((await post(MULTI)).status, 200);
  await app.close();
});

test("anggaran total multi-agent: rantai dihentikan saat waktu habis, tidak menjalankan semua langkah", async () => {
  const { app, post, usage } = await setup({ aiDelayMs: 150, extraEnv: { AI_TOTAL_BUDGET_MS: "600", AI_CALL_TIMEOUT_MS: "5000" } });
  const res = await post(MULTI);
  assert.equal(res.status, 504);
  assert.equal((await res.json()).code, "ai_timeout");
  assert.ok(app.aiCalls.length >= 2 && app.aiCalls.length < 4, `panggilan model: ${app.aiCalls.length}`);
  assert.equal(usage().guest, 0);                                               // jatah 3 unit dikembalikan
  await app.close();
});

test("rantai multi-agent yang cukup cepat tetap selesai penuh dengan anggaran default", async () => {
  const { app, post } = await setup({ aiDelayMs: 20 });
  const res = await post(MULTI);
  assert.equal(res.status, 200);
  assert.ok(app.aiCalls.length >= 4);
  await app.close();
});
