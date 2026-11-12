import fs from 'node:fs';
const cfg = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
const database = cfg.d1_databases?.find(item => item.binding === 'DB');
if (database?.database_name !== 'bor-ai-chat' || !database.database_id) throw Error('pinned_database_missing');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_DB_API_TOKEN;
if (!account || !token) throw Error('database_audit_credential_missing');
const expected = {
  user_settings: ['users'], sessions: ['users'], conversations: ['users'], messages: ['users', 'conversations'],
  answer_feedback: ['users', 'conversations', 'messages'], user_memories: ['users'],
  public_api_keys: ['users'], github_oauth_states: ['users'], github_connections: ['users']
};
// Only a closed set of PRAGMA schema reads: no user rows, writes or deletion.
for (const [table, parents] of Object.entries(expected)) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/d1/database/${encodeURIComponent(database.database_id)}/query`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sql: `PRAGMA foreign_key_list(${table})`, params: [] }), signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true || body.result?.[0]?.success !== true) {
    console.error('d1_schema_audit_http_status=' + response.status);
    throw Error('d1_schema_metadata_unavailable');
  }
  const foreignKeys = body.result[0].results;
  if (!Array.isArray(foreignKeys) || !parents.every(parent => foreignKeys.some(row => row.table === parent && row.on_delete === 'CASCADE'))) {
    console.error('d1_schema_table=' + table + '; contract=MISMATCH');
    throw Error('d1_schema_cascade_contract_mismatch');
  }
}
console.log('d1_schema_cascade_contract=PASS; tables=9; production_user_rows_read=0; writes=0');
console.log('live_synthetic_deletion=UNVERIFIED; backup_retention=UNVERIFIED; independent_privacy_signoff=OPEN');
