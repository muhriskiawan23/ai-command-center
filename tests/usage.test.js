import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startHarness, seedSession } from "./e2e/harness.js";

const ALICE = { id: "sub-alice-usage", email: "alice@example.com" };

test("usage: akun hanya melihat kuota hari ini miliknya, bukan total global atau akun lain", async () => {
  const app = await startHarness();
  const token = seedSession(app.db, ALICE);
  seedSession(app.db, { id: "sub-bob-usage", email: "bob@example.com", name: "Bob" });
  const day = new Date().toISOString().slice(0, 10);
  app.db.sqlite.prepare("INSERT INTO daily_usage (day,subject,units,updated_at) VALUES (?,?,?,?)").run(day, "user:" + ALICE.id, 7, 1);
  app.db.sqlite.prepare("INSERT INTO daily_usage (day,subject,units,updated_at) VALUES (?,?,?,?)").run(day, "user:sub-bob-usage", 42, 1);
  app.db.sqlite.prepare("INSERT INTO daily_usage (day,subject,units,updated_at) VALUES (?,?,?,?)").run(day, "global", 99, 1);
  const response = await fetch(app.url + "/api/usage", { headers: { Cookie: "__Host-borai_session=" + token } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual({ scope: data.scope, used: data.used, limit: data.limit, remaining: data.remaining }, { scope: "user", used: 7, limit: 150, remaining: 143 });
  assert.equal(data.day, day);
  assert.equal(data.unit, "unit penggunaan");
  const nextDay = new Date(Date.parse(day + "T00:00:00.000Z") + 86400000).toISOString();
  assert.equal(data.resetsAt, nextDay);
  assert.equal(JSON.stringify(data).includes("sub-bob-usage"), false);
  assert.equal(JSON.stringify(data).includes("99"), false);
  await app.close();
});

test("usage: guest hanya melihat counter IP-hash sendiri dan limit guest", async () => {
  const app = await startHarness({ extraEnv: { USAGE_SALT: "test-salt" } });
  const day = new Date().toISOString().slice(0, 10);
  const ip = "203.0.113.9";
  const subject = "guest:" + createHash("sha256").update(day + "|" + ip + "|test-salt").digest("hex").slice(0, 32);
  app.db.sqlite.prepare("INSERT INTO daily_usage (day,subject,units,updated_at) VALUES (?,?,?,?)").run(day, subject, 4, 1);
  const response = await fetch(app.url + "/api/usage", { headers: { "CF-Connecting-IP": ip } });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual({ scope: data.scope, used: data.used, limit: data.limit, remaining: data.remaining }, { scope: "guest", used: 4, limit: 15, remaining: 11 });
  await app.close();
});

test("usage: endpoint read-only dan menolak method selain GET", async () => {
  const app = await startHarness();
  const response = await fetch(app.url + "/api/usage", { method: "POST" });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET");
  await app.close();
});
