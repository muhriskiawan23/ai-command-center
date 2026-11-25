import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { reserveStagingBrowserSlot, releaseStagingBrowserSlot } from "../src/browser-staging-budget.js";

const TOKEN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = Date.parse("2026-11-21T08:00:00Z");
const MIGRATION = new URL("../staging/browser/migrations/0001_browser_staging_budget.sql", import.meta.url);

function realStagingD1() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(MIGRATION, "utf8"));
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() { return sqlite.prepare(sql).get(...args) ?? null; },
            async run() { return { meta: { changes: sqlite.prepare(sql).run(...args).changes } }; }
          };
        }
      };
    }
  };
  const env = {
    STAGING_BROWSER_ENABLED: "true",
    STAGING_BROWSER_DAILY_SECONDS_LIMIT: "60",
    STAGING_BROWSER_RESERVATION_SECONDS: "30",
    BROWSER_DB: db
  };
  return { sqlite, env };
}

test("real SQLite migration is valid and enforces an atomic daily browser-seconds cap", async t => {
  const { sqlite, env } = realStagingD1();
  t.after(() => sqlite.close());
  const a = await reserveStagingBrowserSlot(env, { now: NOW, token: TOKEN_A });
  assert.equal(a.ok, true);
  assert.equal(a.remainingSeconds, 30);
  await releaseStagingBrowserSlot(env, TOKEN_A);
  const b = await reserveStagingBrowserSlot(env, { now: NOW + 100, token: TOKEN_B });
  assert.equal(b.ok, true);
  assert.equal(b.remainingSeconds, 0);
  await releaseStagingBrowserSlot(env, TOKEN_B);
  const c = await reserveStagingBrowserSlot(env, { now: NOW + 200, token: TOKEN_A });
  assert.equal(c.ok, false);
  assert.equal(c.code, "browser_daily_quota_exhausted");
  assert.equal(sqlite.prepare("SELECT reserved_seconds FROM browser_staging_usage WHERE day = ?").get("2026-11-21").reserved_seconds, 60);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM browser_staging_lease").get().n, 0);
});

test("real SQLite lease serializes two concurrent operator browser requests", async t => {
  const { sqlite, env } = realStagingD1();
  t.after(() => sqlite.close());
  const [first, second] = await Promise.all([
    reserveStagingBrowserSlot(env, { now: NOW, token: TOKEN_A }),
    reserveStagingBrowserSlot(env, { now: NOW + 1, token: TOKEN_B })
  ]);
  assert.equal([first.ok, second.ok].filter(Boolean).length, 1);
  assert.equal([first.code, second.code].includes("browser_busy"), true);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM browser_staging_lease").get().n, 1);
  assert.equal(sqlite.prepare("SELECT reserved_seconds FROM browser_staging_usage").get().reserved_seconds, 30);
  await releaseStagingBrowserSlot(env, first.ok ? TOKEN_A : TOKEN_B);
});

test("expired real SQLite lease is reclaimed without resetting the same-day budget", async t => {
  const { sqlite, env } = realStagingD1();
  t.after(() => sqlite.close());
  assert.equal((await reserveStagingBrowserSlot(env, { now: NOW, token: TOKEN_A })).ok, true);
  const next = await reserveStagingBrowserSlot(env, { now: NOW + 41_000, token: TOKEN_B });
  assert.equal(next.ok, true);
  assert.equal(next.remainingSeconds, 0);
  assert.equal(sqlite.prepare("SELECT owner_token FROM browser_staging_lease").get().owner_token, TOKEN_B);
  assert.equal(await releaseStagingBrowserSlot(env, TOKEN_A), true);
  assert.equal(sqlite.prepare("SELECT owner_token FROM browser_staging_lease").get().owner_token, TOKEN_B);
  assert.equal(await releaseStagingBrowserSlot(env, TOKEN_B), true);
});

test("quota migration cannot persist over-cap or invalid lease rows", t => {
  const { sqlite } = realStagingD1();
  t.after(() => sqlite.close());
  assert.throws(() => sqlite.prepare("INSERT INTO browser_staging_usage(day,reserved_seconds) VALUES (?,?)").run("2026-11-21", 121), /constraint/i);
  assert.throws(() => sqlite.prepare("INSERT INTO browser_staging_usage(day,reserved_seconds) VALUES (?,?)").run("2026-11-21", -1), /constraint/i);
  assert.throws(() => sqlite.prepare("INSERT INTO browser_staging_lease(slot,owner_token,expires_ms) VALUES (?,?,?)").run(2, TOKEN_A, NOW), /constraint/i);
});
