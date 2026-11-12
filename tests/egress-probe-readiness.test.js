import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForProbe, safeProbeError } from '../tools/egress-proxy/runtime/probe-client.mjs';
test('new proof endpoint waits for authentication denial, not a successful public request', async () => {
  const responses = [404, 503, 401]; let count = 0;
  await waitForProbe('https://test.invalid/run', { fetcher: async (_url, options) => {
    assert.equal(options.headers, undefined);
    return new Response(null, { status: responses[count++] });
  }, wait: async () => {} });
  assert.equal(count, 3);
});
test('proof readiness does not accept an open or persistently unavailable endpoint', async () => {
  await assert.rejects(waitForProbe('https://test.invalid/run', { fetcher: async () => new Response(null, { status: 200 }) }), /unexpected_status/);
  await assert.rejects(waitForProbe('https://test.invalid/run', { attempts: 2, wait: async () => {}, fetcher: async () => new Response(null, { status: 503 }) }), /not_ready/);
});
test('runtime errors preserve only fixed codes and valid HTTP status', () => {
  assert.deepEqual(safeProbeError({ message: 'secret-token-with-private-host', proxyStatus: 999 }), { reason: 'runtime_proof_failed', proxyStatus: null });
  assert.deepEqual(safeProbeError({ message: 'authentication_denial_failed', proxyStatus: 502 }), { reason: 'authentication_denial_failed', proxyStatus: 502 });
});
