import test from 'node:test';
import assert from 'node:assert/strict';
import { closeExistingSession, requestProviderHangup } from '../provider-hangup.mjs';

test('sideband success does not trigger HTTP hangup', async () => {
  const result = await closeExistingSession({ sessionId: 'live_test', observe: async () => ({ requestClose() {} }), disconnect: assert.fail, hangup: assert.fail });
  assert.equal(result, 'sideband_close_requested');
});
test('attach failure invokes HTTP fallback once for the existing session', async () => {
  const calls = [];
  const result = await closeExistingSession({ sessionId: 'live_test', observe: async () => { throw Error('attach_failed'); }, disconnect: () => { throw Error('disconnect_failed'); }, hangup: async id => { calls.push(id); } });
  assert.deepEqual(calls, ['live_test']);
  assert.equal(result, 'http_hangup_requested');
});
test('failure to send sideband close and failure of HTTP preserve uncertainty', async () => {
  const result = await closeExistingSession({ sessionId: 'live_test', observe: async () => ({ requestClose() { throw Error('socket_closed'); } }), disconnect() {}, hangup: async () => { throw Error('timeout'); } });
  assert.equal(result, 'unconfirmed');
});
test('HTTP adapter posts only to the specified session hangup endpoint', async () => {
  let calls = 0;
  const result = await requestProviderHangup({ sessionId: 'live_test', authorization: 'Bearer fake-test-key', fetchImpl: async (url, opts) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/live/sessions/live_test/hangup'); assert.equal(opts.method, 'POST'); assert.equal(opts.redirect, 'error'); assert.equal(opts.headers.Authorization, 'Bearer fake-test-key'); assert.equal(opts.signal.aborted, false);
    return new Response(null, { status: 204 });
  } });
  assert.equal(calls, 1); assert.equal(result, 'http_hangup_requested');
});
test('invalid session ID never sends an HTTP request', async () => {
  await assert.rejects(requestProviderHangup({ sessionId: 'live_x/../other', authorization: 'Bearer fake', fetchImpl: assert.fail }), /invalid_live_session/);
});
test('non-success response cannot count as a confirmed close', async () => {
  await assert.rejects(requestProviderHangup({ sessionId: 'live_test', authorization: 'Bearer fake', fetchImpl: async () => new Response(null, { status: 404 }) }), /live_hangup_unconfirmed/);
});
