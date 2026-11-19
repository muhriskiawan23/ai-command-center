// Creates/reuses only the dedicated test DB and emits a separate deploy config.
import fs from 'node:fs';

const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
if (!/^[a-f0-9]{32}$/i.test(account || '') || !token) throw Error('Cloudflare credentials are required.');
const name = 'bor-ai-duitku-sandbox';
async function api(path, method = 'GET', body) {
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + account + path, {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(30000)
  });
  const result = await response.json();
  if (!response.ok || result.success !== true) throw Error('Sandbox provisioning failed (HTTP ' + response.status + '). Check D1 permissions.');
  return result.result;
}
let database;
for (let page = 1; page <= 100; page++) {
  const entries = await api('/d1/database?per_page=100&page=' + page);
  if (!Array.isArray(entries)) throw Error('Unexpected D1 inventory.');
  database = entries.find(entry => entry.name === name);
  if (database || entries.length < 100) break;
  if (page === 100) throw Error('D1 inventory exceeds bounded pagination.');
}
if (!database) database = await api('/d1/database', 'POST', { name });
if (database.name !== name || !/^[a-f0-9-]{36}$/i.test(database.uuid || '')) throw Error('Unexpected sandbox database identity.');
const production = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
if (production.d1_databases.some(entry => entry.database_id === database.uuid)) throw Error('Refusing to bind a production database.');
const config = JSON.parse(fs.readFileSync('wrangler.duitku-sandbox.jsonc', 'utf8'));
if (config.name !== name || config.main !== 'src/duitku-sandbox-worker.js' || config.vars.PAYMENT_SANDBOX_ENABLED !== 'true') throw Error('Unexpected sandbox configuration.');
config.d1_databases = [{ binding: 'SANDBOX_DB', database_name: name, database_id: database.uuid, migrations_dir: 'sandbox/duitku/migrations' }];
fs.writeFileSync('wrangler.duitku-sandbox.generated.jsonc', JSON.stringify(config, null, 2) + '\n');
console.log('Verified dedicated Duitku sandbox database and prepared sandbox-only configuration.');
