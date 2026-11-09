// Batas pemakaian harian (perlindungan biaya AI), diuji pada SQLite nyata dengan skema dari migrations/.
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { startHarness, seedSession } from "./e2e/harness.js";

const ALICE = { id: "sub-alice", email: "alice@example.com" };
const MULTI = "Buat rencana promosi dan analisis risiko untuk usaha saya, tanpa modal.";

async function setup(extraEnv = {}, options = {}) {
  const app = await startHarness({ extraEnv, ...options });
  const post = (message, { cookie, ip = "10.0.0.1" } = {}) => fetch(app.url + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: app.url, "CF-Connecting-IP": ip, ...(cookie ? { Cookie: `__Host-borai_session=${cookie}` } : {}) },
    body: JSON.stringify({ message })
  });
  const usage = () => Object.fromEntries(app.db.sqlite.prepare("SELECT subject, units FROM daily_usage").all().map((r) => [r.subject.startsWith("guest:") ? "guest" : r.subject, r.units]));
  return { app, post, usage };
}

test("tamu: jatah harian per IP; setelah habis → 429 dengan pesan jelas; IP lain tidak terpengaruh", async () => {
  const { app, post } = await setup({ DAILY_LIMIT_GUEST: "3" });
  for (let i = 1; i <= 3; i++) assert.equal((await post(`pesan ${i}`)).status, 200);
  const denied = await post("pesan 4");
  const body = await denied.json();
  assert.equal(denied.status, 429);
  assert.equal(body.code, "daily_limit");
  assert.equal(body.scope, "guest");
  assert.match(body.error, /Batas harian tamu tercapai \(3 pesan\)/);
  assert.match(body.error, /Masuk dengan Google/);
  assert.ok(Number(denied.headers.get("Retry-After")) > 0 && Number(denied.headers.get("Retry-After")) <= 86400);
  assert.equal((await post("dari ip lain", { ip: "10.0.0.2" })).status, 200);
  await app.close();
});

test("akun login: jatah terpisah per akun dan lebih besar dari tamu (default 150 vs 15)", async () => {
  const { app, post, usage } = await setup({ DAILY_LIMIT_USER: "2", DAILY_LIMIT_GUEST: "1" });
  const alice = seedSession(app.db, ALICE);
  assert.equal((await post("a1", { cookie: alice })).status, 200);
  assert.equal((await post("a2", { cookie: alice })).status, 200);
  const denied = await post("a3", { cookie: alice });
  assert.equal(denied.status, 429);
  assert.equal((await denied.json()).scope, "user");
  const bob = seedSession(app.db, { id: "sub-bob", email: "bob@example.com" });
  assert.equal((await post("b1", { cookie: bob })).status, 200);       // akun lain tidak terpengaruh
  assert.equal(usage()["user:sub-alice"], 2);
  await app.close();
});

test("nilai default sesuai keputusan: tamu 15, akun 150, seluruh aplikasi 1500", async () => {
  const app = await startHarness();
  const token = seedSession(app.db, ALICE);
  const now = usageDayUtc();
  app.db.sqlite.prepare("INSERT INTO daily_usage (day, subject, units, updated_at) VALUES (?, 'user:sub-alice', 149, 0), (?, 'global', 1499, 0)").run(now, now);
  const post = () => fetch(app.url + "/api/chat", { method: "POST", headers: { "Content-Type": "application/json", Origin: app.url, Cookie: `__Host-borai_session=${token}` }, body: JSON.stringify({ message: "halo" }) });
  assert.equal((await post()).status, 200);                           // pesan ke-150 akun dan ke-1500 global: masih boleh
  const denied = await post();
  assert.equal(denied.status, 429);
  assert.equal((await denied.json()).scope, "user");                  // 151 ditolak oleh batas akun (150)
  await app.close();
});

test("alur multi-agent dihitung 3 unit, pesan biasa 1 unit", async () => {
  const { app, post, usage } = await setup({ DAILY_LIMIT_GUEST: "5" });
  assert.equal((await post(MULTI)).status, 200);
  assert.equal(usage().guest, 3);
  assert.equal((await post("halo")).status, 200);
  assert.equal((await post("halo lagi")).status, 200);
  assert.equal(usage().guest, 5);
  assert.equal((await post("tolak")).status, 429);
  const heavy = await post(MULTI);                                    // 3 unit tidak muat di sisa 0
  assert.equal(heavy.status, 429);
  await app.close();
});

test("batas global: ditolak untuk semua; jatah pengguna yang ditolak dikembalikan", async () => {
  const { app, post, usage } = await setup({ DAILY_LIMIT_GLOBAL: "2" });
  assert.equal((await post("g1", { ip: "1.1.1.1" })).status, 200);
  assert.equal((await post("g2", { ip: "2.2.2.2" })).status, 200);
  const denied = await post("g3", { ip: "3.3.3.3" });
  assert.equal(denied.status, 429);
  const body = await denied.json();
  assert.equal(body.scope, "global");
  assert.match(body.error, /batas pemakaian harian/i);
  assert.equal(usage().global, 2);
  const rows = app.db.sqlite.prepare("SELECT subject, units FROM daily_usage WHERE subject LIKE 'guest:%'").all();
  assert.equal(rows.length, 3);
  assert.equal(rows.filter((r) => r.units === 0).length, 1);          // IP ke-3 tidak kehilangan jatah gara-gara batas global
  await app.close();
});

test("error saat menaikkan counter global mengembalikan jatah pengguna yang sudah terpotong", async () => {
  const { app, post, usage } = await setup();
  const originalPrepare = app.db.prepare.bind(app.db);
  app.db.prepare = (sql) => {
    const statement = originalPrepare(sql);
    if (!sql.includes("INSERT INTO daily_usage")) return statement;
    return {
      bind: (...values) => {
        const bound = statement.bind(...values);
        if (values[1] !== "global") return bound;
        return { ...bound, first: async () => { throw new Error("simulated global counter D1 failure"); } };
      }
    };
  };

  const failed = await post("global counter error");
  assert.equal(failed.status, 503);
  assert.equal(usage().guest, 0);                                    // charge parsial tidak boleh tertinggal
  assert.equal(usage().global, undefined);                            // global belum berhasil dikonsumsi
  assert.equal(app.aiCalls.length, 0);                                // AI tidak dipanggil setelah kegagalan kuota

  app.db.prepare = originalPrepare;
  assert.equal((await post("recovered")).status, 200);                // setelah DB pulih, permintaan normal berjalan
  assert.equal(usage().guest, 1);
  assert.equal(usage().global, 1);
  await app.close();
});

test("AI gagal: jatah dikembalikan sehingga kegagalan tidak menghabiskan batas harian", async () => {
  const { app, post, usage } = await setup({ DAILY_LIMIT_GUEST: "2" });
  app.control.aiFail = true;
  assert.equal((await post("gagal 1")).status, 502);
  assert.equal((await post("gagal 2")).status, 502);
  assert.equal((await post("gagal 3")).status, 502);                  // tidak pernah menjadi 429
  assert.equal(usage().guest, 0);
  assert.equal(usage().global, 0);
  app.control.aiFail = false;
  assert.equal((await post("ok 1")).status, 200);
  assert.equal((await post("ok 2")).status, 200);
  assert.equal((await post("ok 3")).status, 429);
  await app.close();
});

test("ganti hari: jatah kemarin tidak terbawa, dan hitungan lama dibersihkan", async () => {
  const { app, post, usage } = await setup({ DAILY_LIMIT_GUEST: "1" });
  const yesterday = usageDayUtc(-1), longAgo = usageDayUtc(-10);
  app.db.sqlite.prepare("INSERT INTO daily_usage (day, subject, units, updated_at) VALUES (?, 'guest:lama', 999, 0), (?, 'global', 999, 0), (?, 'global', 5, 0)").run(yesterday, yesterday, longAgo);
  assert.equal((await post("hari ini")).status, 200);                 // kemarin penuh, hari ini bersih
  assert.equal((await post("kedua")).status, 429);
  const days = app.db.sqlite.prepare("SELECT DISTINCT day FROM daily_usage ORDER BY day").all().map((r) => r.day);
  assert.ok(!days.includes(longAgo), "hitungan 10 hari lalu harus dibersihkan");
  assert.ok(days.includes(yesterday) && days.includes(usageDayUtc(0)));
  assert.equal(usage().global, 1);
  await app.close();
});

test("IP tidak pernah disimpan mentah di database", async () => {
  const { app, post } = await setup();
  await post("halo", { ip: "203.0.113.77" });
  const dump = JSON.stringify(app.db.sqlite.prepare("SELECT * FROM daily_usage").all());
  assert.ok(!dump.includes("203.0.113.77"));
  assert.match(dump, /guest:[0-9a-f]{32}/);
  await app.close();
});

test("tabel daily_usage belum ada: chat gagal tertutup dan pembatasan tidak dilewati", async () => {
  const { app, post } = await setup();
  app.db.sqlite.exec("DROP TABLE daily_usage");
  const logs = []; const original = console.error; console.error = (...a) => logs.push(a.join(" "));
  try {
    const response = await post("tanpa tabel");
    assert.equal(response.status, 503);
    assert.match(await response.text(), /pembatasan pemakaian belum siap/i);
  } finally { console.error = original; }
  assert.ok(logs.some((l) => /Daily usage limits unavailable/i.test(l)), "harus ada peringatan jelas di log");
  await app.close();
});

test("error database lain: gagal tertutup (503 tanpa detail internal) dan AI tidak dipanggil", async () => {
  let aiCalls = 0;
  const env = {
    AI: { async run() { aiCalls++; return { response: "x" }; } },
    DB: { prepare() { return { bind() { return this; }, first: async () => { throw new Error("D1 internal-secret"); }, all: async () => ({ results: [] }), run: async () => ({}) }; } }
  };
  const res = await worker.fetch(new Request("https://example.test/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "halo" }) }), env);
  const text = await res.text();
  assert.equal(res.status, 503);
  assert.ok(!text.includes("internal-secret"));
  assert.equal(aiCalls, 0);
});

function usageDayUtc(offsetDays = 0) { return new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10); }
