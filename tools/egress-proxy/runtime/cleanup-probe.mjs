import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export async function cleanupProbe(env, fetcher = fetch) {
  if (env.GITHUB_REF !== 'refs/heads/main' || !/^\d+$/.test(env.GITHUB_RUN_ID || '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || '')) throw Error('cleanup_context_invalid');
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) throw Error('cleanup_credentials_missing');
  const name = `bor-egress-proof-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/workers/scripts/${name}`;
  const options = { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, signal: AbortSignal.timeout(20000) };
  const metadata = await fetcher(endpoint + '/settings', options);
  await metadata.body?.cancel();
  if (metadata.status === 404) { console.log('temporary_probe_cleanup_confirmed=absent'); return; }
  if (metadata.status !== 200) throw Error('cleanup_metadata_unavailable');
  const response = await fetcher(endpoint + '?force=true', { ...options, method: 'DELETE' });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) throw Error('cleanup_delete_failed');
  console.log('temporary_probe_cleanup_confirmed=removed');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await cleanupProbe(process.env);
