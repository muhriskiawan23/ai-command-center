import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const path='.github/workflows/bor-ai-one-shot-backup-version-audit-20261123.yml';
const yaml=readFileSync(path,'utf8');
const target=readFileSync('.github/workflows/bor-ai-isolated-backup-worker-version-audit.yml','utf8');

test('used deploy bridge is retired before requesting new GET-only verification',()=>{
  assert.equal(existsSync('.github/workflows/bor-ai-one-shot-isolated-backup-deploy-20261123.yml'),false);
  assert.equal(existsSync('tests/bor-ai-one-shot-isolated-backup-deploy.test.js'),false);
  assert.match(yaml,/on:\n  push:\n    branches: \[main\]/);
  assert.match(yaml,/github\.run_attempt == 1/);
  assert.match(yaml,/GITHUB_RUN_ATTEMPT" == "1"/);
  assert.match(yaml,/b6e7618e787dd68e35adb25911a34abffcacbafc/);
  assert.match(yaml,/git rev-parse HEAD\^/);
  assert.match(yaml,/git diff --name-only/);
  assert.match(yaml,/git ls-remote origin refs\/heads\/main/);
});

test('bridge has only one dispatch: exact official read-only version audit',()=>{
  assert.match(yaml,/permissions:\n  contents: read\n  actions: write/);
  assert.match(yaml,/GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(yaml,/gh api --method POST/);
  assert.match(yaml,/actions\/workflows\/bor-ai-isolated-backup-worker-version-audit\.yml\/dispatches/);
  assert.match(yaml,/inputs\[reviewed_main_sha\]=\$GITHUB_SHA/);
  assert.match(yaml,/inputs\[owner_confirmation\]=AUDIT_ISOLATED_BACKUP_DEPLOYMENT_ONLY/);
  assert.match(target,/GET-only inspect deployed isolated Worker version metadata/);
  assert.match(target,/environment: production/);
  assert.doesNotMatch(yaml,/actions\/workflows\/bor-ai-private-chat-backup-release|inputs\[phase\]=|d1 export --|d1 execute|wrangler@.*deploy|secret put|workflows trigger|R2 object put|CLOUDFLARE_API_TOKEN|BOR_PRIVATE_D1_EXPORT_TOKEN/);
  assert.doesNotMatch(yaml,/^\s+(?:schedule|workflow_dispatch|workflow_run):/m);
});
