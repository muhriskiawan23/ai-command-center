import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const path='.github/workflows/bor-ai-one-shot-isolated-backup-deploy-20261123.yml';
const yaml=readFileSync(path,'utf8');
const target=readFileSync('.github/workflows/bor-ai-private-chat-backup-release.yml','utf8');

test('one-shot can only run on main push changing its own workflow file',()=>{
  assert.match(yaml,/^on:\n  push:\n    branches: \[main\]\n    paths:\n      - '\.github\/workflows\/bor-ai-one-shot-isolated-backup-deploy-20261123\.yml'/m);
  assert.match(yaml,/github\.event_name == 'push'/);
  assert.match(yaml,/github\.run_attempt == 1/);
  assert.match(yaml,/GITHUB_RUN_ATTEMPT" == "1"/);
  assert.match(yaml,/72ab4b4d198eb66d07df493568278fa83017dd1c/);
  assert.match(yaml,/git rev-parse HEAD\^/);
  assert.match(yaml,/git diff --name-only/);
  assert.match(yaml,/git ls-remote origin refs\/heads\/main/);
  assert.match(yaml,/Unexpected parent, no owner approval/);
  assert.match(yaml,/Only the reviewed dispatch workflow \+ safety test may change/);
  assert.match(yaml,/release\(backup\): one-time isolated Worker deploy approval/);
  assert.doesNotMatch(yaml,/^\s+(?:schedule|workflow_dispatch|workflow_run):/m);
});

test('one-shot dispatches existing protected deploy workflow, never D1 trigger',()=>{
  assert.match(yaml,/permissions:\n  contents: read\n  actions: write/);
  assert.match(yaml,/GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(yaml,/gh api --method POST/);
  assert.match(yaml,/actions\/workflows\/bor-ai-private-chat-backup-release\.yml\/dispatches/);
  assert.match(yaml,/inputs\[phase\]=deploy/);
  assert.match(yaml,/inputs\[reviewed_main_sha\]=\$GITHUB_SHA/);
  assert.match(yaml,/inputs\[owner_confirmation\]=DEPLOY_BOR_PRIVATE_CHAT_BACKUP/);
  assert.match(yaml,/inputs\[low_traffic_confirmation\]=/);
  assert.doesNotMatch(yaml,/inputs\[phase\]=trigger|workflows trigger|d1 export --|d1 execute|r2 object put|d1 time-travel restore|wrangler@\S+ deploy|OPENAI_API_KEY|CLOUDFLARE_API_TOKEN|BOR_PRIVATE_D1_EXPORT_TOKEN/);
  assert.match(yaml,/THIRD PRODUCTION D1 EXPORT LOCKED/);
  assert.match(target,/if \[\[ "\$PHASE" == "trigger" \]\]; then[\s\S]+?THIRD PRODUCTION D1 EXPORT LOCKED/);
  assert.match(target,/if: \$\{\{ inputs\.phase == 'deploy' \}\}/);
  assert.match(target,/environment: production/);
});

test('preserves exact previously reviewed normal account R2 hostname',()=>{
  assert.match(yaml,/1ad59b064bfa3690063414a9906129e4\.r2\.cloudflarestorage\.com/);
  assert.match(yaml,/\^\[0-9a-f\]\{32\}\\\.r2/);
  assert.match(yaml,/SIGNED_HOST/);
});
