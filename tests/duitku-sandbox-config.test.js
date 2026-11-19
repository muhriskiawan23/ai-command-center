import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const configPath = new URL('../wrangler.duitku-sandbox.jsonc', import.meta.url);
const script = fileURLToPath(new URL('../scripts/provision-duitku-sandbox.mjs', import.meta.url));
const pinned = '0744f4c0-7980-4de1-977d-d8bbd51fe395';
function run({ mode = 'success', productionId = '11111111-1111-4111-8111-111111111111', modify } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'duitku-config-test-'));
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    modify?.(config);
    writeFileSync(join(dir, 'wrangler.duitku-sandbox.jsonc'), JSON.stringify(config));
    writeFileSync(join(dir, 'wrangler.jsonc'), JSON.stringify({ d1_databases: [{ database_id: productionId }] }));
    const mock = join(dir, 'mock.mjs');
    writeFileSync(mock, `
      import fs from 'node:fs';
      globalThis.fetch = async (url, options) => {
        if (url !== 'https://api.cloudflare.com/client/v4/accounts/' + 'a'.repeat(32) + '/d1/database/${pinned}' || options.method !== 'GET') throw Error('Unexpected Cloudflare operation');
        fs.appendFileSync('calls.txt', options.method + ' ' + url + '\\n');
        const mode = process.env.TEST_MODE;
        return Response.json(mode === 'unauthorized' ? {success:false,errors:[{message:'synthetic-token-must-not-leak'}]} : {success:true,result:{
          uuid:mode==='wrong-id'?'22222222-2222-4222-8222-222222222222':'${pinned}',
          name:mode==='wrong-name'?'bor-ai-chat':'bor-ai-duitku-sandbox'
        }}, {status:mode==='unauthorized'?401:200});
      };
    `);
    const result = spawnSync(process.execPath, ['--import', mock, script], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, TEST_MODE: mode,
        CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_API_TOKEN: 'synthetic-token-must-not-leak' }
    });
    return { ...result,
      calls: existsSync(join(dir, 'calls.txt')) ? readFileSync(join(dir, 'calls.txt'), 'utf8').trim().split('\n') : [],
      generated: existsSync(join(dir, 'wrangler.duitku-sandbox.generated.jsonc')) ? JSON.parse(readFileSync(join(dir, 'wrangler.duitku-sandbox.generated.jsonc'), 'utf8')) : null
    };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('pinned Duitku deployment verifies only the owner-created DB and preserves its dedicated migration binding', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.generated.d1_databases, [{ binding:'SANDBOX_DB', database_name:'bor-ai-duitku-sandbox', database_id:pinned, migrations_dir:'sandbox/duitku/migrations' }]);
});
test('Duitku deployment refuses a production DB or extra bindings before any network access', () => {
  for (const options of [{ productionId:pinned }, { modify:config=>config.d1_databases.push({binding:'DB',database_id:'unexpected'}) }, { modify:config=>config.d1_databases[0].migrations_dir='migrations' }]) {
    const result = run(options);
    assert.notEqual(result.status, 0); assert.equal(result.calls.length, 0); assert.equal(result.generated, null);
  }
});
test('rejected Cloudflare credentials and mismatched database identities never produce deploy configuration', () => {
  for (const mode of ['unauthorized','wrong-id','wrong-name']) {
    const result = run({mode});
    assert.notEqual(result.status, 0); assert.equal(result.generated, null); assert.equal(result.calls.length, 1);
    assert.doesNotMatch(result.stdout + result.stderr, /synthetic-token-must-not-leak/);
  }
});
