import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyImageSchemaPending} from '../scripts/verify-image-schema-pending.mjs';

const table=(names)=>'Migrations to be applied:\n┌───────────────────────────────────────────┐\n'+
  '│ Name                                      │\n'+
  names.map(name=>'│ '+name+' '.repeat(Math.max(0,41-name.length))+'│').join('\n')+
  '\n└───────────────────────────────────────────┘\n';

test('a pinned image-only pending pair passes without remote activity',()=>{
  const result=verifyImageSchemaPending(table(['0012_image_jobs.sql','0016_image_chat_history.sql']));
  assert.deepEqual(result.pending,['0012_image_jobs.sql','0016_image_chat_history.sql']);
  assert.equal(result.safe,true);
  assert.equal(result.length,2);
});
test('billing or other SQL pending blocks; missing or reordered images block',()=>{
  const inputs=[
    ['0012_image_jobs.sql','0013_billing_foundation.sql','0016_image_chat_history.sql'],
    ['0012_image_jobs.sql','0014_billing_invoice_reference_guard.sql','0016_image_chat_history.sql'],
    ['0012_image_jobs.sql','0015_billing_sandbox_invoice_recovery.sql','0016_image_chat_history.sql'],
    ['0016_image_chat_history.sql','0012_image_jobs.sql'],
    ['0012_image_jobs.sql'],
    ['0012_image_jobs.sql','0016_image_chat_history.sql','0017_unknown.sql'],
    ['0012_image_jobs.sql','an_unexpected_file.sql','0016_image_chat_history.sql'],
    ['0012_image_jobs.sql','unrecognized migration row','0016_image_chat_history.sql'],
    ['0012_image_jobs.sql','0012_image_jobs.sql','0016_image_chat_history.sql']
  ];
  for(const names of inputs)assert.throws(()=>verifyImageSchemaPending(table(names)),/drifted|duplicate/);
});
test('empty, altered or oversized Wrangler response never authorizes apply',()=>{
  assert.throws(()=>verifyImageSchemaPending(''),/absent/);
  assert.throws(()=>verifyImageSchemaPending('ok\n'),/drifted/);
  assert.throws(()=>verifyImageSchemaPending('x'.repeat(32769)),/limit/);
  assert.throws(()=>verifyImageSchemaPending('No migrations to apply!'),/drifted/);
  assert.throws(()=>verifyImageSchemaPending('Migrations to be applied:\nno table'),/drifted/);
});
test('post-apply expectation accepts only proven no-pending response',()=>{
  const okay=verifyImageSchemaPending('No migrations to apply!',{expectNone:true});
  assert.equal(okay.length,0);
  assert.throws(()=>verifyImageSchemaPending(table(['0012_image_jobs.sql']),{expectNone:true}),/empty pending set/);
  assert.throws(()=>verifyImageSchemaPending('success',{expectNone:true}),/empty pending set/);
});
test('manual workflow defaults to PLAN and cannot deploy Worker or activate paid features',()=>{
  const w=readFileSync(new URL('../.github/workflows/bor-ai-image-d1-release.yml',import.meta.url),'utf8');
  assert.match(w,/workflow_dispatch:/);
  assert.match(w,/default: plan/);
  // Colons inside inline YAML run commands are parsed as mapping values.
  // Require a block scalar for the final plan status and reject risky inline echo.
  assert.match(w,/\- name: Explain safety status[\s\S]*?\n\s+run: \|\n\s+echo "PLAN complete: D1/);
  assert.doesNotMatch(w,/^\s*run: echo "[^"\n]*:\s/m);
  assert.match(w,/environment: production/);
  assert.match(w,/group: bor-ai-production-deploy/);
  assert.match(w,/git ls-remote origin refs\/heads\/main/);
  assert.match(w,/GITHUB_REF/);
  assert.match(w,/CONFIRM_IMAGE_SCHEMA_0012_0016_BOR_AI_CHAT/);
  assert.match(w,/node scripts\/check-production-migration-isolation\.mjs migrations/);
  assert.match(w,/node scripts\/verify-d1-image-migration-rollback\.mjs/);
  assert.match(w,/d1 migrations apply bor-ai-chat --remote --config wrangler\.image-only-migrations\.generated\.jsonc/);
  assert.doesNotMatch(w,/\b(push|pull_request|schedule):/);
  assert.doesNotMatch(w,/\bwrangler[^\n]*\bdeploy\b/);
  assert.doesNotMatch(w,/\bsecret put\b|\bqueue create\b|\br2 bucket create\b/);
  const indexInventory=w.indexOf('node scripts/verify-image-schema-pending.mjs');
  const indexBookmark=w.indexOf('node scripts/verify-d1-image-migration-rollback.mjs');
  const indexApply=w.indexOf('d1 migrations apply bor-ai-chat --remote');
  assert.ok(indexInventory>0&&indexBookmark>indexInventory&&indexApply>indexBookmark);
});
