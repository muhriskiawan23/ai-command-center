import test from 'node:test';
import assert from 'node:assert/strict';
const expected = { user_settings:['users'], sessions:['users'], conversations:['users'], messages:['users','conversations'], answer_feedback:['users','conversations','messages'], user_memories:['users'], public_api_keys:['users'], github_oauth_states:['users'], github_connections:['users'] };
function installFake(t, missingCascade = false) {
  const before = { fetch: globalThis.fetch, log: console.log, error: console.error, account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_DB_API_TOKEN };
  const statements = [], logs = [];
  process.env.CLOUDFLARE_ACCOUNT_ID = 'synthetic-account'; process.env.CLOUDFLARE_DB_API_TOKEN = 'synthetic-secret';
  console.log = line => logs.push(line); console.error = line => logs.push(line);
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authorization, 'Bearer synthetic-secret');
    const { sql, params } = JSON.parse(options.body);
    assert.deepEqual(params, []);
    const match = /^PRAGMA foreign_key_list\(([a-z_]+)\)$/.exec(sql);
    assert.ok(match, 'only schema PRAGMA statements may be issued');
    assert.ok(Object.hasOwn(expected, match[1])); statements.push(sql);
    return Response.json({ success: true, result: [{ success: true, results: expected[match[1]].map(table => ({ table, on_delete: missingCascade ? 'NO ACTION' : 'CASCADE' })) }] });
  };
  t.after(() => {
    globalThis.fetch = before.fetch; console.log = before.log; console.error = before.error;
    for (const [key, value] of [['CLOUDFLARE_ACCOUNT_ID',before.account],['CLOUDFLARE_DB_API_TOKEN',before.token]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  return { statements, logs };
}
test('live privacy audit reads only a closed set of schema metadata and never emits credentials', async t => {
  const { statements, logs } = installFake(t);
  await import('../tools/egress-proxy/runtime/privacy-schema-audit.mjs?pass');
  assert.equal(statements.length, 9);
  assert.match(logs.join('\n'), /production_user_rows_read=0; writes=0/);
  assert.doesNotMatch(logs.join('\n'), /synthetic-secret|synthetic-account/);
});
test('missing cascade cannot be reported as passed privacy schema evidence', async t => {
  installFake(t, true);
  await assert.rejects(import('../tools/egress-proxy/runtime/privacy-schema-audit.mjs?fail'), /cascade_contract_mismatch/);
});
