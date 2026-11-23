import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkPublicSurface, PUBLIC_CORE_TARGETS, probePublicCore } from '../scripts/public-core-liveness.mjs';

const health = () => Response.json({ ok: true, service: 'BOR AI' });
const agents = () => Response.json({ agents: [{ id: 'coordinator' }, { id: 'researcher' }, { id: 'writer' }] });
const html = () => new Response('<html><title>BOR AI</title></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });

function successfulResponse(url) {
  const path = new URL(url).pathname;
  return path === '/api/health' ? health() : path === '/api/agents' ? agents() : html();
}

test('read-only public core checks use only preapproved HTTPS BOR AI endpoints, GET, and no credentials', async () => {
  const calls = [];
  const result = await probePublicCore(async (url, options) => {
    calls.push({ url, options });
    return successfulResponse(url);
  });
  assert.equal(result.length, 6);
  assert.ok(result.every(x => x.ok));
  assert.equal(calls.length, 6);
  assert.ok(calls.every(({ url, options }) => url.startsWith('https://') && options.method === 'GET' &&
    options.redirect === 'manual' && options.cache === 'no-store' &&
    !Object.keys(options.headers).some(x => /authorization|cookie/i.test(x))));
  assert.ok(calls.every(({ url }) => !/\/api\/chat|\/api\/health\?deep|tavily|openai|\/api\/images/.test(url)));
});

test('read-only probe detects a disabled API host without sending a chat inference', async () => {
  const result = await probePublicCore(async url => new URL(url).hostname === 'app.getborai.com'
    ? new Response('PRIVATE RESPONSE BODY - DO NOT LOG', { status: 503 }) : successfulResponse(url));
  assert.equal(result.filter(x => !x.ok).length, 3);
  assert.ok(result.filter(x => !x.ok).every(x => x.reason === 'http_error' && x.status === 503));
  assert.ok(!JSON.stringify(result).includes('PRIVATE RESPONSE BODY'));
});

test('rejects untrusted locations and unexpected targets without fetching them', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.redirect('https://evil.example/collect', 302); };
  const r = await checkPublicSurface(PUBLIC_CORE_TARGETS[0], fetcher);
  assert.equal(r.reason, 'unexpected_redirect');
  assert.equal(calls, 1);
  const unapproved = await checkPublicSurface({ label: 'app health', url: 'https://evil.example', kind: 'health' }, fetcher);
  assert.equal(unapproved.reason, 'unapproved_target');
  assert.equal(calls, 1);
  const sneaky = await checkPublicSurface(PUBLIC_CORE_TARGETS[0], async () => { calls++; return Response.redirect('https://app.getborai.com/api/chat', 302); });
  assert.equal(sneaky.reason, 'unexpected_redirect');
  assert.equal(calls, 2);
});

test('bounded same-family redirect may be checked, but infinite redirects fail closed', async () => {
  let calls = 0;
  const target = PUBLIC_CORE_TARGETS.find(x => x.label === 'marketing home');
  const r = await checkPublicSurface(target, async url => {
    calls++;
    return url === 'https://getborai.com/' ? Response.redirect('https://app.getborai.com/', 302) : html();
  });
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
  const loop = await checkPublicSurface(target, async () => Response.redirect('https://getborai.com/', 301));
  assert.equal(loop.reason, 'redirect_loop');
});

test('rejects misleading JSON and oversized metadata without disclosing body', async () => {
  const healthTarget = PUBLIC_CORE_TARGETS.find(x => x.kind === 'health');
  const malformed = await checkPublicSurface(healthTarget, async () => Response.json({ ok: false, service: 'BOR AI' }));
  assert.equal(malformed.reason, 'unhealthy');
  const tooBig = await checkPublicSurface(healthTarget, async () =>
    Response.json({ ok: true, service: 'BOR AI', secret: 'SYNTHETIC_SECRET'.repeat(10000) }));
  assert.equal(tooBig.ok, false);
  assert.ok(!JSON.stringify(tooBig).includes('SYNTHETIC_SECRET'));
});

test('manual-only operational check must not run on push, cron or use deployment credentials', () => {
  const yaml = readFileSync(new URL('../.github/workflows/bor-ai-public-core-liveness.yml', import.meta.url), 'utf8');
  assert.match(yaml, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(yaml, /\n\s+(?:push|schedule|pull_request):/);
  assert.match(yaml, /permissions:\n  contents: read/);
  assert.doesNotMatch(yaml, /secrets\.|wrangler|api\/chat|\/api\/health\?deep|tavily|openai|\bPOST\b/);
  assert.match(yaml, /node scripts\/public-core-liveness\.mjs/);
});
