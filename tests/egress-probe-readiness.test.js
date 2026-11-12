import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForProbe, safeProbeError, fetchAuthenticatedProbe } from '../tools/egress-proxy/runtime/probe-client.mjs';
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

test('authenticated probe retries only endpoint startup and never logs the token', async () => {
  const statuses = [503, 404, 200]; const reports = [];
  const response = await fetchAuthenticatedProbe('https://test.invalid/run', 'synthetic-secret', {
    fetcher: async (_url, opts) => {
      assert.equal(opts.headers.authorization, 'Bearer synthetic-secret');
      return new Response(null, { status: statuses.shift() });
    }, wait: async () => {}, report: value => reports.push(value)
  });
  assert.equal(response.status, 200);
  assert.equal(statuses.length, 0);
  assert.ok(!reports.join('').includes('synthetic-secret'));
});
test('authenticated probe does not retry a security rejection or incorrect authorization', async () => {
  for (const status of [401, 502]) {
    let count = 0;
    const response = await fetchAuthenticatedProbe('https://test.invalid/run', 'synthetic-secret', {
      fetcher: async () => { count++; return new Response(null, { status }); },
      wait: async () => { throw Error('must not retry'); }
    });
    assert.equal(response.status, status);
    assert.equal(count, 1);
  }
});
test('authenticated endpoint startup failure stays bounded', async () => {
  let count = 0;
  await assert.rejects(fetchAuthenticatedProbe('https://test.invalid/run', 'synthetic-secret', {
    attempts: 2, wait: async () => {}, fetcher: async () => { count++; return new Response(null, { status: 503 }); }
  }), /not_ready/);
  assert.equal(count, 2);
});
