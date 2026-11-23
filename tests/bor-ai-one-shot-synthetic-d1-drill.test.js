import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const yaml=readFileSync('.github/workflows/bor-ai-one-shot-synthetic-d1-drill-20261123.yml','utf8');
const target=readFileSync('.github/workflows/bor-ai-synthetic-d1-recovery.yml','utf8');
const driver=readFileSync('scripts/synthetic-d1-export-recovery-drill.mjs','utf8');

test('one-shot dispatch uses main push of THIS workflow, exact parent/diff, first attempt only',()=>{
  assert.match(yaml,/on:\n  push:\n    branches: \[main\]/);
  assert.match(yaml,/github\.event_name == 'push'/);
  assert.match(yaml,/github\.run_attempt == 1/);
  assert.match(yaml,/GITHUB_RUN_ATTEMPT" == "1"/);
  assert.match(yaml,/49b758c517c7a951e7bfa0b99dab82a90c74f8e2/);
  assert.match(yaml,/git rev-parse HEAD\^/);
  assert.match(yaml,/git diff --name-only/);
  assert.match(yaml,/git ls-remote origin refs\/heads\/main/);
  assert.match(yaml,/release\(recovery\): one approved synthetic D1 drill only/);
  assert.doesNotMatch(yaml,/^\s+(?:workflow_dispatch|workflow_run|schedule):/m);
});
test('only existing protected two-D1 fake-content drill is dispatched and old production export stays locked',()=>{
  assert.match(yaml,/permissions:\n  contents: read\n  actions: write/);
  assert.match(yaml,/GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(yaml,/actions\/workflows\/bor-ai-synthetic-d1-recovery\.yml\/dispatches/);
  assert.match(yaml,/inputs\[phase\]=drill/);
  assert.match(yaml,/inputs\[reviewed_main_sha\]=\$GITHUB_SHA/);
  assert.match(yaml,/inputs\[owner_confirmation\]=I_APPROVE_SYNTHETIC_D1_CREATE_EXPORT_RESTORE_CLEANUP/);
  assert.match(yaml,/inputs\[storage_cost_approval\]=I_APPROVE_TEMP_SYNTHETIC_D1_CLOUDFLARE_USAGE/);
  assert.match(yaml,/THIRD PRODUCTION D1 EXPORT LOCKED/);
  assert.match(target,/environment: production/);
  assert.match(target,/GITHUB_REF/);
  assert.match(driver,/PRIMARY_D1_PIN='d71231a9-9a04-471c-b904-d1bc843940aa'/);
  assert.match(driver,/validateSyntheticResource/);
  assert.match(driver,/finally\s*\{\s*await cleanup\(\)/);
  assert.doesNotMatch(yaml,/bor-ai-private-chat-backup-release\.yml\/dispatches|inputs\[phase\]=trigger|d1\/database\/.+\/export|wrangler@.*deploy|secret put|workflows trigger|BOR_PRIVATE_D1_EXPORT_TOKEN/);
});
test('D1 polling always includes required output_format',()=>{
  assert.match(driver,/\{output_format:'polling',current_bookmark:bookmark\}/);
});
