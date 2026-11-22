import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const workflow=readFileSync('.github/workflows/bor-ai-private-chat-backup-r2-provision.yml','utf8');
test('private R2 provisioning is manual and defaults to read-only PLAN',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/options: \[plan, provision\]/);
  assert.match(workflow,/default: plan/);
  assert.match(workflow,/environment: production/);
  assert.match(workflow,/group: bor-ai-production-deploy/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.match(workflow,/Only main allowed/);
  assert.match(workflow,/PLAN must not include production resource approval/);
  assert.doesNotMatch(workflow,/^\s+(?:push|pull_request|schedule):/m);
});
test('mutating creation requires independent owner approval of 30d storage cost and exact reviewed SHA',()=>{
  assert.match(workflow,/CREATE_ONLY_BOR_AI_CHAT_PRIVATE_R2_BACKUP_BUCKET/);
  assert.match(workflow,/I_APPROVE_PRIVATE_CHAT_BACKUP_30_DAY_STORAGE_COST/);
  assert.match(workflow,/\"\$REVIEWED\" == \"\$GITHUB_SHA\"/);
  assert.match(workflow,/git ls-remote origin refs\/heads\/main/);
  assert.match(workflow,/secrets\.CLOUDFLARE_R2_BACKUP_PROVISION_TOKEN/);
  assert.doesNotMatch(workflow,/secrets\.CLOUDFLARE_D1_MIGRATION_TOKEN/);
  assert.doesNotMatch(workflow,/secrets\.OPENAI_API_KEY/);
});
test('fail closed when the private backup bucket exists, metadata is unverifiable or credential missing',()=>{
  assert.match(workflow,/res\.status===404/);
  assert.match(workflow,/Bucket already exists: do NOT replace/);
  assert.match(workflow,/Bucket absence cannot be verified/);
  assert.match(workflow,/Dedicated R2 backup provisioning credential absent/);
  const locate=workflow.indexOf('- name: Confirm dedicated bucket is ABSENT');
  const create=workflow.indexOf('- name: Create ONLY the separately approved empty');
  assert.ok(locate>0&&create>locate);
});
test('creation operates solely on approved R2 bucket then turns OFF r2.dev and verifies 30 day lifecycle',()=>{
  const create=workflow.indexOf('r2 bucket create bor-ai-chat-private-backups');
  const disable=workflow.indexOf('r2 bucket dev-url disable bor-ai-chat-private-backups --force');
  const lifecycle=workflow.indexOf('r2 bucket lifecycle add');
  const audit=workflow.indexOf('node scripts/verify-private-backup-r2-preflight.mjs');
  assert.ok(create>0&&disable>create&&lifecycle>disable&&audit>lifecycle);
  assert.match(workflow,/bor-ai-chat-private-backups bor-chat-private-backup-retention/);
  assert.match(workflow,/private\/bor-ai-chat\/ --expire-days 30 --force/);
  assert.doesNotMatch(workflow,/r2 bucket delete|r2 object put|r2 object get|r2 bucket dev-url enable/);
  assert.doesNotMatch(workflow,/d1 export|d1 execute|d1 migrations apply|d1 time-travel restore|d1 backup restore/);
  assert.doesNotMatch(workflow,/wrangler(?:@\S+)?\s+deploy\b|OPENAI_API_KEY|TAVILY_API_KEY/);
});
test('no live Cloudflare API calls or resource provisioning in PLAN phase',()=>{
  assert.match(workflow,/if: \$\{\{ inputs\.phase == 'provision' \}\}/);
  assert.match(workflow,/Report that planning has not created resources/);
  assert.match(workflow,/no Cloudflare API calls, R2 objects, bucket create, D1 export/);
});
