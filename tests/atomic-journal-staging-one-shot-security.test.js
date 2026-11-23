import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync(
  '.github/workflows/bor-ai-one-shot-atomic-journal-staging-upgrade-20261123.yml','utf8'
);
test('one-shot staging upgrade is pinned to reviewed main parent/title/EXACT six files',()=>{
  assert.match(workflow,/^on:\n  push:\n    branches: \[main\]/m);
  assert.match(workflow,/github\.event_name == 'push'/);
  assert.match(workflow,/github\.run_attempt == 1/);
  assert.match(workflow,/GITHUB_RUN_ATTEMPT" == "1"/);
  assert.match(workflow,/REVIEWED_PARENT: 57265cbe852a85ef440e30a541dfd2c9a2a001aa/);
  assert.match(workflow,/release\(journal\): upgrade isolated atomic DO staging only/);
  assert.match(workflow,/git rev-parse HEAD\^/);
  assert.match(workflow,/git diff --name-only/);
  assert.match(workflow,/git ls-remote origin refs\/heads\/main/);
  assert.match(workflow,/THIRD PRODUCTION D1 EXPORT LOCKED/);
  for(const path of [
    '.github/workflows/bor-ai-one-shot-atomic-journal-staging-upgrade-20261123.yml',
    'docs/CHAT-JOURNAL-DURABLE-OBJECT-STAGING.md',
    'src/chat-journal-staging-atomic-drill.js',
    'src/chat-journal-staging-worker.js',
    'tests/atomic-journal-staging-one-shot-security.test.js',
    'tests/chat-journal-cloudflare-staging-atomic.test.js'
  ]) assert.ok(workflow.includes("'"+path+"'"),path);
  assert.doesNotMatch(workflow,/^\s+(?:workflow_dispatch|workflow_run|schedule):/m);
});

test('staging upgrade fails closed before deploy and never creates/exposes production resources',()=>{
  assert.match(workflow,/environment: production/);
  assert.match(workflow,/CLOUDFLARE_BACKUP_DEPLOY_TOKEN/);
  assert.match(workflow,/workers\/scripts\/bor-ai-chat-journal-staging/);
  assert.match(workflow,/existing\.status!==200/);
  assert.match(workflow,/body\.result\?\.enabled!==false/);
  assert.match(workflow,/body\.result\?\.previews_enabled!==false/);
  assert.match(workflow,/value\.result\?\.previews_enabled!==false/);
  assert.match(workflow,/CHAT_JOURNAL_ACTIVE!=='false'/);
  assert.match(workflow,/CHAT_JOURNAL_STAGING_SYNTHETIC_ONLY!=='true'/);
  assert.match(workflow,/npx --yes wrangler@4\.165\.0 deploy --dry-run/);
  assert.match(workflow,/npx --yes wrangler@4\.165\.0 deploy --experimental-auto-create=false/);
  assert.match(workflow,/wrangler\.chat-journal-staging\.generated\.jsonc/);
  assert.doesNotMatch(workflow,/wrangler@4.*\b(d1|r2|secret put|delete|publish|pages)\b/);
  assert.doesNotMatch(workflow,/BOR_PRIVATE_D1_EXPORT_TOKEN|MIDTRANS_|TAVILY_API_KEY|--remote|wrangler\.jsonc\s*$/m);
  assert.doesNotMatch(workflow,/\bapi\.getborai\.com\b|\bapp\.getborai\.com\b/);
});

test('one accepted synthetic V2 Workflow, safe receipt and no generic user input',()=>{
  assert.match(workflow,/BOR_SYNTHETIC_CLOSED_ATOMIC_TURN_DRILL_V2/);
  assert.match(workflow,/bor-atomic-synthetic-\$\{GITHUB_RUN_ID\}-1/);
  assert.match(workflow,/workflows trigger/);
  assert.match(workflow,/--id "\$instance"/);
  assert.match(workflow,/bor-ai-chat-journal-staging-drill-v1/);
  assert.match(workflow,/output\?\.drillVersion!==2/);
  assert.match(workflow,/output\?\.atomicTurns!==2/);
  assert.match(workflow,/output\?\.erasedPayloadEvents!==8/);
  assert.match(workflow,/output\?\.duplicateRetriesVerified!==3/);
  assert.match(workflow,/output\?\.customerDataAccessed!==false/);
  assert.match(workflow,/output\?\.productionD1Accessed!==false/);
  assert.doesNotMatch(workflow,/\b(?:account_id|user_id|conversation_id)\] = \$\{|inputs\[/);
});
