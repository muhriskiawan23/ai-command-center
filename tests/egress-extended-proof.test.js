import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURE_TEXT, fixtureResponse, runExtendedProof } from '../tools/egress-proxy/runtime/extended-proof.js';
function environment(tlsFailure = 'certificate has expired') {
  let slowCalls = 0;
  const calls = [];
  const env = { FIXTURE_ORIGIN: 'https://probe.owner.workers.dev', EGRESS_PROXY_TOKEN: 'a'.repeat(48), EGRESS_PROXY: { async fetch(_url, options) {
    const url = new URL(JSON.parse(options.body).url); calls.push(url.href);
    let error;
    if (url.hostname === 'expired.badssl.com') error = tlsFailure;
    if (url.hostname === 'wrong.host.badssl.com') error = 'Hostname/IP does not match certificate';
    if (url.hostname === 'self-signed.badssl.com') error = 'self-signed certificate';
    if (url.pathname === '/fixture/large') error = 'response_too_large';
    if (url.pathname === '/fixture/slow') {
      if (++slowCalls === 1) error = 'request_timeout';
      else return new Promise((_resolve, reject) => {
        const abort = () => reject(new DOMException('Aborted', 'AbortError'));
        if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
      });
    }
    if (error) return Response.json({ error }, { status: 502 });
    return Response.json({ status: url.pathname === '/fixture/redirect' ? 302 : 200,
      headers: { 'content-type': 'text/plain', location: 'http://127.0.0.1/' }, bodyBase64: btoa(FIXTURE_TEXT), peerIp: '93.184.215.14',
      transport: { selectedPeerIp: '93.184.215.14', observedPeerIp: '93.184.215.14', peerIpVerified: true,
        tlsAuthorized: true, tlsIdentityVerified: true, tlsServername: url.hostname } });
  } } };
  return { env, calls };
}
test('hosted suite requires TLS-specific failures, private redirect revalidation and bounded abort', async () => {
  const { env, calls } = environment();
  const result = await runExtendedProof(env);
  assert.equal(Object.keys(result).length, 8);
  assert.ok(Object.values(result).every(value => value === true));
  assert.ok(calls.every(url => !url.startsWith('http://127.0.0.1')));
});
test('a generic TLS-site network outage cannot pass certificate rejection tests', async () => {
  await assert.rejects(runExtendedProof(environment('dns_timeout').env), /expired_certificate_not_denied/);
});
test('fixtures have fixed synthetic content and destinations and do not accept POST targets', async () => {
  const response = await fixtureResponse(new Request('https://probe.owner.workers.dev/fixture/public?url=https://private.invalid'));
  assert.equal(await response.text(), FIXTURE_TEXT);
  const redirect = await fixtureResponse(new Request('https://probe.owner.workers.dev/fixture/redirect?target=https://private.invalid'));
  assert.equal(redirect.headers.get('location'), 'http://127.0.0.1/');
  const large = await fixtureResponse(new Request('https://probe.owner.workers.dev/fixture/large'));
  assert.equal((await large.arrayBuffer()).byteLength, 1_000_001);
  assert.equal(await fixtureResponse(new Request('https://probe.owner.workers.dev/fixture/public', { method: 'POST' })), null);
});
