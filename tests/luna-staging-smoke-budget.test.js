import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { claimStagingSearchSmoke, finishStagingSearchSmoke } from '../src/luna-staging-smoke-budget.js';
const now = Date.UTC(2026, 10, 25, 20, 30);
const reserve = 260000;
const baseId = 'web-v2-responses-20261126-f';
function fixture(t, paid = 228947, ledger = 228420) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec("CREATE TABLE web_search_v2_usage (day TEXT PRIMARY KEY, calls INTEGER NOT NULL CHECK (calls > 0), reserved_micro_usd INTEGER NOT NULL CHECK (reserved_micro_usd > 0)); CREATE TABLE web_search_v2_live_evaluation (id TEXT PRIMARY KEY, status TEXT NOT NULL, evidence_json TEXT)");
  if (ledger) db.prepare('INSERT INTO web_search_v2_usage VALUES (?,9,?)').run('2026-11-25', ledger);
  db.prepare('INSERT INTO web_search_v2_live_evaluation VALUES (?,?,?)').run(baseId, 'completed', JSON.stringify({ chargedMicroUsd: paid }));
  const DB = { prepare(sql) { return { bind(...args) { const ordered = sql.includes('?1') ? Object.fromEntries(args.map((v,i) => [String(i+1),v])) : args; const call = (method) => Array.isArray(ordered) ? db.prepare(sql)[method](...ordered) : db.prepare(sql)[method](ordered); return { first: async () => call('get') || null, run: async () => call('run') }; } }; } };
  const env = { DB, BOR_LUNA_STAGING_WEB_SEARCH_ENABLED: 'true', BOR_LUNA_SEARCH_SMOKE_BASE_ID: baseId, BOR_LUNA_SEARCH_SMOKE_EXPIRES_AT: String(now + 60000) };
  return { env, db };
}
test('real SQLite admits historical campaign with router overhead and one full reservation', async t => {
  const { env, db } = fixture(t);
  const claims = await Promise.all(Array.from({ length: 8 }, () => claimStagingSearchSmoke(env, reserve, now)));
  const accepted = claims.filter(Boolean);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].ledgerLimit, 499473);
  assert.equal(accepted[0].evidence.budgetCommittedMicroUsd, 488947);
  assert.equal(db.prepare("SELECT count(*) AS n FROM web_search_v2_live_evaluation WHERE id LIKE 'web-v2-smoke-%'").get().n, 1);
});
test('one-shot marker persists after provider failure and across UTC month rollover', async t => {
  const { env, db } = fixture(t);
  const claim = await claimStagingSearchSmoke(env, reserve, now);
  await finishStagingSearchSmoke(env, claim, false, 429);
  const saved = db.prepare('SELECT status,evidence_json FROM web_search_v2_live_evaluation WHERE id=?').get(claim.id);
  assert.equal(saved.status, 'stopped');
  assert.equal(JSON.parse(saved.evidence_json).reservedMicroUsd, reserve);
  const nextMonth = Date.UTC(2026, 11, 1);
  env.BOR_LUNA_SEARCH_SMOKE_EXPIRES_AT = String(nextMonth + 60000);
  assert.equal(await claimStagingSearchSmoke(env, reserve, nextMonth), null);
});
test('cumulative spend or unsettled search ledger over cap prevents admission', async t => {
  for (const [paid, ledger] of [[250000, 228420], [228947, 250000]]) {
    const { env } = fixture(t, paid, ledger);
    assert.equal(await claimStagingSearchSmoke(env, reserve, now), null);
  }
});
test('older evidence cannot bypass a larger recorded campaign total', async t => {
  const { env, db } = fixture(t, 1000, 1000);
  db.prepare('INSERT INTO web_search_v2_live_evaluation VALUES (?,?,?)').run('web-v2-newer-evidence', 'completed', '{"chargedMicroUsd":300000}');
  assert.equal(await claimStagingSearchSmoke(env, reserve, now), null);
});
test('running evaluation prevents smoke admission', async t => {
  const { env, db } = fixture(t);
  db.prepare('INSERT INTO web_search_v2_live_evaluation VALUES (?,?,?)').run('web-v2-other-evaluation', 'running', null);
  assert.equal(await claimStagingSearchSmoke(env, reserve, now), null);
});
test('unknown or invalid paid evidence is not accepted', async t => {
  for (const paid of [null, '228947', -1, 1.25]) {
    const { env } = fixture(t, paid, 0);
    assert.equal(await claimStagingSearchSmoke(env, reserve, now), null);
  }
});
test('missing consent window, stale expiry, kill switch and simultaneous evaluation config fail closed', async t => {
  const { env } = fixture(t);
  for (const patch of [{ BOR_LUNA_SEARCH_SMOKE_BASE_ID: '' }, { BOR_LUNA_SEARCH_SMOKE_EXPIRES_AT: String(now) }, { BOR_LUNA_SEARCH_SMOKE_EXPIRES_AT: String(now + 901000) }, { BOR_WEB_SEARCH_KILL_SWITCH: 'true' }, { BOR_LUNA_LIVE_EVAL_ID: baseId }, { BOR_LUNA_STAGING_WEB_SEARCH_ENABLED: 'false' }]) {
    assert.equal(await claimStagingSearchSmoke({ ...env, ...patch }, reserve, now), null);
  }
});
