import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('dedicated D1 credential probe is manual, production-protected and read-only',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/bor-ai-d1-write-token-readonly-preflight.yml',import.meta.url),'utf8');
  assert.match(yaml,/workflow_dispatch:/);
  assert.match(yaml,/environment: production/);
  assert.match(yaml,/group: bor-ai-production-deploy/);
  assert.match(yaml,/ref: \$\{\{ github\.sha \}\}/);
  assert.match(yaml,/refs\/heads\/main/);
  assert.match(yaml,/database_name!=="bor-ai-chat"/);
  assert.match(yaml,/database_id!=="d71231a9-9a04-471c-b904-d1bc843940aa"/);
  assert.match(yaml,/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_D1_MIGRATION_TOKEN \}\}/);
  assert.match(yaml,/--command "SELECT 1 AS bor_ai_d1_token_probe"/);
  assert.match(yaml,/wrangler@4\.165\.0 d1 execute bor-ai-chat --remote/);
  assert.doesNotMatch(yaml,/d1 migrations apply|d1 time-travel restore|d1 backup restore|d1 export|d1 backup download|--file\b|--command "UPDATE|--command "DELETE|--command "INSERT/);
  assert.doesNotMatch(yaml,/wrangler(?:@\S+)?\s+deploy\b|r2 object put|secret put|OPENAI_API_KEY|curl [^\n]*chat|api\/messages/);
  assert.doesNotMatch(yaml,/on:\s*\n(?:\s+(?:push|pull_request|schedule):)/);
});

test('write token is never passed to the source checkout, shell preflight or output parser',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/bor-ai-d1-write-token-readonly-preflight.yml',import.meta.url),'utf8');
  const step='      - name: Confirm dedicated D1 Edit token can execute a literal SELECT 1 (NO WRITES)';
  const next='      - name: Clarify this probe does not establish backup or migration clearance';
  const a=yaml.indexOf(step),b=yaml.indexOf(next,a);
  assert.ok(a>0&&b>a);
  const isolated=yaml.slice(a,b);
  const other=yaml.slice(0,a)+yaml.slice(b);
  assert.match(isolated,/secrets\.CLOUDFLARE_D1_MIGRATION_TOKEN/);
  assert.doesNotMatch(other,/secrets\.CLOUDFLARE_D1_MIGRATION_TOKEN/);
  assert.match(isolated,/set -euo pipefail/);
  assert.match(isolated,/No production rows, writes, restore or Worker deploy/);
  assert.match(yaml,/not establish backup or migration clearance/);
});
