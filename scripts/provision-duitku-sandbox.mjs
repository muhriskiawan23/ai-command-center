// Verifies the owner-created, pinned test DB and emits a separate deploy config.
import fs from 'node:fs';

const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
if (!/^[a-f0-9]{32}$/i.test(account || '') || !token) throw Error('Cloudflare credentials are required.');
const name = 'bor-ai-duitku-sandbox';
const config = JSON.parse(fs.readFileSync('wrangler.duitku-sandbox.jsonc', 'utf8'));
if (config.name !== name || config.main !== 'src/duitku-sandbox-worker.js' || config.vars.PAYMENT_SANDBOX_ENABLED !== 'true') throw Error('Unexpected sandbox configuration.');
const bindings = config.d1_databases;
if (!Array.isArray(bindings) || bindings.length !== 1) throw Error('Exactly one dedicated sandbox database must be pinned.');
const binding = bindings[0];
if (binding.binding !== 'SANDBOX_DB' || binding.database_name !== name || binding.migrations_dir !== 'sandbox/duitku/migrations'
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(binding.database_id || '')) throw Error('Unexpected sandbox database binding.');
const production = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
if (production.d1_databases.some(entry => entry.database_id === binding.database_id)) throw Error('Refusing to bind a production database.');
async function api(path) {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + path, {
    method: 'GET', headers: { Authorization: 'Bearer ' + token },
    redirect: 'error', signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (!response.ok || result.success !== true) throw Error('Pinned sandbox database verification failed (HTTP ' + response.status + '). Check Cloudflare authentication and account/D1 access.');
  return result.result;
}
const database = await api('/d1/database/' + binding.database_id);
if (database.name !== name || database.uuid !== binding.database_id) throw Error('Unexpected sandbox database identity.');
fs.writeFileSync('wrangler.duitku-sandbox.generated.jsonc', JSON.stringify(config, null, 2) + '\n');
console.log('Verified dedicated Duitku sandbox database and prepared sandbox-only configuration.');
