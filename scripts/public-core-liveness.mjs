// Manual, read-only BOR AI public-surface probe. No AI inference or account data.
// Only preapproved public BOR AI origins. No credentials, cookies or POSTs.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TRUSTED_HOSTS = new Set([
  'getborai.com', 'www.getborai.com', 'app.getborai.com',
  'ai-command-center.muhriskiawan23.workers.dev'
]);

export const PUBLIC_CORE_TARGETS = Object.freeze([
  { label: 'app home', url: 'https://app.getborai.com/', kind: 'html' },
  { label: 'app health', url: 'https://app.getborai.com/api/health', kind: 'health' },
  { label: 'app agents', url: 'https://app.getborai.com/api/agents', kind: 'agents' },
  { label: 'worker health', url: 'https://ai-command-center.muhriskiawan23.workers.dev/api/health', kind: 'health' },
  { label: 'worker agents', url: 'https://ai-command-center.muhriskiawan23.workers.dev/api/agents', kind: 'agents' },
  { label: 'marketing home', url: 'https://getborai.com/', kind: 'html' }
]);

function trustedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && TRUSTED_HOSTS.has(url.hostname) &&
      !url.username && !url.password && !url.search && !url.hash && url.port === '' ? url : null;
  } catch { return null; }
}

async function readLimitedBody(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return '';
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error('payload_too_large');
      chunks.push(value);
    }
  } finally {
    // The body is public health metadata only. Never print it or echo failures.
    try { await reader.cancel(); } catch { /* best-effort */ }
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export async function checkPublicSurface(target, fetcher = fetch) {
  if (!PUBLIC_CORE_TARGETS.some(x => x.label === target?.label && x.url === target.url && x.kind === target.kind))
    return { label: 'unexpected', ok: false, reason: 'unapproved_target' };
  let current = trustedUrl(target.url);
  if (!current) return { label: target.label, ok: false, reason: 'unapproved_target' };
  const seen = new Set();
  try {
    for (let redirects = 0; redirects < 3; redirects++) {
      if (seen.has(current.href)) return { label: target.label, ok: false, reason: 'redirect_loop' };
      seen.add(current.href);
      const response = await fetcher(current.href, {
        method: 'GET', redirect: 'manual', cache: 'no-store',
        headers: { Accept: target.kind === 'html' ? 'text/html' : 'application/json' },
        signal: AbortSignal.timeout(12_000)
      });
      if (response.status >= 300 && response.status < 400) {
        const next = trustedUrl(new URL(response.headers.get('location') || '', current.href).href);
        // A redirect must preserve the exact audited resource type. Never
        // follow a public-domain redirect into another application route.
        if (next && next.pathname !== new URL(target.url).pathname)
          return { label: target.label, ok: false, reason: 'unexpected_redirect', status: response.status };
        if (!next) return { label: target.label, ok: false, reason: 'unexpected_redirect', status: response.status };
        current = next;
        continue;
      }
      if (response.status !== 200) return { label: target.label, ok: false, reason: 'http_error', status: response.status };
      const type = (response.headers.get('content-type') || '').toLowerCase();
      if (target.kind === 'html') {
        return { label: target.label, ok: /^text\/html(?:\s*;|\s*$)/.test(type),
          reason: /^text\/html(?:\s*;|\s*$)/.test(type) ? 'ok' : 'invalid_html', status: 200 };
      }
      if (!/^application\/json(?:\s*;|\s*$)/.test(type))
        return { label: target.label, ok: false, reason: 'invalid_json_type', status: 200 };
      let parsed;
      try { parsed = JSON.parse(await readLimitedBody(response, 64_000)); }
      catch { return { label: target.label, ok: false, reason: 'invalid_json', status: 200 }; }
      if (target.kind === 'health') {
        const ok = parsed?.ok === true && ['BOR AI', 'AI Command Center'].includes(parsed?.service);
        return { label: target.label, ok, reason: ok ? 'ok' : 'unhealthy', status: 200 };
      }
      const ids = Array.isArray(parsed?.agents) ? parsed.agents.map(x => x?.id) : [];
      const ok = ['coordinator', 'researcher', 'writer'].every(id => ids.includes(id));
      return { label: target.label, ok, reason: ok ? 'ok' : 'invalid_agents', status: 200 };
    }
    return { label: target.label, ok: false, reason: 'too_many_redirects' };
  } catch {
    // Never log exception strings, URLs, response bodies, cookies or tokens.
    return { label: target.label, ok: false, reason: 'connection_failed' };
  }
}

export async function probePublicCore(fetcher = fetch) {
  return Promise.all(PUBLIC_CORE_TARGETS.map(target => checkPublicSurface(target, fetcher)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = await probePublicCore();
  for (const { label, ok, reason, status } of results) {
    process.stdout.write((ok ? 'PASS' : 'FAIL') + ' ' + label + ': ' + reason + (status ? ' (HTTP ' + status + ')' : '') + '\n');
  }
  if (results.some(x => !x.ok)) {
    process.stderr.write('Public core liveness check failed; this is not an AI/provider availability test.\n');
    process.exitCode = 1;
  }
}
