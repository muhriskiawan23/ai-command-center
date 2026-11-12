import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupProbe } from '../tools/egress-proxy/runtime/cleanup-probe.mjs';
const env = { GITHUB_REF:'refs/heads/main', GITHUB_RUN_ID:'123', GITHUB_RUN_ATTEMPT:'2', CLOUDFLARE_ACCOUNT_ID:'test', CLOUDFLARE_API_TOKEN:'synthetic-secret' };
test('cleanup only removes the fixed run-specific Worker', async () => {
  const calls = [];
  await cleanupProbe(env, async (url, options) => {
    assert.ok(url.includes('/workers/scripts/bor-egress-proof-123-2'));
    calls.push(options.method || 'GET');
    return options.method === 'DELETE' ? Response.json({success:true}) : Response.json({});
  });
  assert.deepEqual(calls, ['GET','DELETE']);
});
test('cleanup accepts already-absent Worker and rejects unsafe context before network access', async () => {
  let calls = 0;
  await cleanupProbe(env, async () => { calls++; return new Response(null,{status:404}); });
  assert.equal(calls, 1);
  await assert.rejects(cleanupProbe({...env,GITHUB_RUN_ID:'ai-command-center'},async () => { throw Error('must not run'); }),/context_invalid/);
});
