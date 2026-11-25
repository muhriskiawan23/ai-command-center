import test from "node:test";
import assert from "node:assert/strict";
import {
  reserveStagingBrowserSlot, releaseStagingBrowserSlot,
  STAGING_BROWSER_MAX_DAILY_SECONDS
} from "../src/browser-staging-budget.js";

const TOKEN_A = "11111111-1111-4111-8111-111111111111";
const TOKEN_B = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-11-21T04:00:00Z");

export function fakeBrowserStagingDb() {
  const used = new Map();
  let lease = null;
  return {
    get used() { return used; },
    get lease() { return lease; },
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("INSERT INTO browser_staging_lease")) {
                const [token, expires, now] = args;
                if (lease && lease.expires > now) return null;
                lease = { token, expires };
                return { slot: 1 };
              }
              if (sql.includes("INSERT INTO browser_staging_usage")) {
                const [day, seconds, alsoSeconds, max, checkMax] = args;
                assert.equal(seconds, alsoSeconds);
                assert.equal(max, checkMax);
                const total = (used.get(day) || 0) + seconds;
                if (total > max) return null;
                used.set(day, total);
                return { reserved_seconds: total };
              }
              throw Error("Unexpected D1 SQL");
            },
            async run() {
              if (!sql.includes("DELETE FROM browser_staging_lease")) throw Error("Unexpected D1 SQL");
              if (lease?.token === args[0]) lease = null;
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
}
export function stagingEnv(db = fakeBrowserStagingDb()) {
  return {
    BROWSER_DB: db, STAGING_BROWSER_ENABLED: "true",
    STAGING_BROWSER_DAILY_SECONDS_LIMIT: "60",
    STAGING_BROWSER_RESERVATION_SECONDS: "30"
  };
}

test("staging budget fails closed on missing DB, invalid/zero cap, disabled flag or missing token", async () => {
  assert.equal((await reserveStagingBrowserSlot({}, { now: NOW, token: TOKEN_A })).code, "staging_not_ready");
  const db = fakeBrowserStagingDb();
  const env = stagingEnv(db);
  for (const changed of [
    { BROWSER_DB: null }, { STAGING_BROWSER_ENABLED: "false" },
    { STAGING_BROWSER_DAILY_SECONDS_LIMIT: "0" },
    { STAGING_BROWSER_DAILY_SECONDS_LIMIT: "100000" },
    { STAGING_BROWSER_RESERVATION_SECONDS: "0" },
    { STAGING_BROWSER_RESERVATION_SECONDS: "31" },
    { STAGING_BROWSER_RESERVATION_SECONDS: "30.5" }
  ]) {
    assert.equal((await reserveStagingBrowserSlot({ ...env, ...changed }, { now: NOW, token: TOKEN_A })).code, "staging_not_ready");
  }
  assert.equal((await reserveStagingBrowserSlot(env, { now: NOW, token: "not-a-token" })).code, "staging_not_ready");
  assert.equal(db.lease, null);
});

test("D1 lease prevents concurrent staging sessions and guards release ownership", async () => {
  const db = fakeBrowserStagingDb(), env = stagingEnv(db);
  const first = await reserveStagingBrowserSlot(env, { now: NOW, token: TOKEN_A });
  assert.equal(first.ok, true);
  assert.equal(first.remainingSeconds, 30);
  assert.equal((await reserveStagingBrowserSlot(env, { now: NOW + 100, token: TOKEN_B })).code, "browser_busy");
  assert.equal(await releaseStagingBrowserSlot(env, TOKEN_B), true);
  assert.equal(db.lease.token, TOKEN_A);
  assert.equal(await releaseStagingBrowserSlot(env, TOKEN_A), true);
  assert.equal(db.lease, null);
  assert.equal((await reserveStagingBrowserSlot(env, { now: NOW + 200, token: TOKEN_B })).ok, true);
});

test("each staging attempt reserves browser seconds even when browser launch later fails", async () => {
  const db = fakeBrowserStagingDb(), env = stagingEnv(db);
  assert.equal((await reserveStagingBrowserSlot(env, { now: NOW, token: TOKEN_A })).ok, true);
  await releaseStagingBrowserSlot(env, TOKEN_A);
  const second = await reserveStagingBrowserSlot(env, { now: NOW + 100, token: TOKEN_B });
  assert.equal(second.ok, true);
  assert.equal(second.remainingSeconds, 0);
  await releaseStagingBrowserSlot(env, TOKEN_B);
  const third = await reserveStagingBrowserSlot(env, { now: NOW + 200, token: TOKEN_A });
  assert.equal(third.code, "browser_daily_quota_exhausted");
  assert.equal(db.lease, null);
  assert.equal(db.used.get("2026-11-21"), 60);
});

test("expired lease can be taken by a new operator session; daily quota remains", async () => {
  const db = fakeBrowserStagingDb(), env = stagingEnv(db);
  assert.equal((await reserveStagingBrowserSlot(env, { now: NOW, token: TOKEN_A })).ok, true);
  const next = await reserveStagingBrowserSlot(env, { now: NOW + 41_000, token: TOKEN_B });
  assert.equal(next.ok, true);
  assert.equal(db.lease.token, TOKEN_B);
  await releaseStagingBrowserSlot(env, TOKEN_B);
  assert.equal(db.used.get("2026-11-21"), 60);
});

test("staging budget never accepts more than its code-level upper bound", async () => {
  const db = fakeBrowserStagingDb();
  assert.equal((await reserveStagingBrowserSlot({
    ...stagingEnv(db),
    STAGING_BROWSER_DAILY_SECONDS_LIMIT: String(STAGING_BROWSER_MAX_DAILY_SECONDS + 1)
  }, { now: NOW, token: TOKEN_A })).code, "staging_not_ready");
});
