import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMAGE_MIGRATION_ALLOWLIST, BLOCKED_BILLING_MIGRATIONS,
  inspectImageMigrationPlan, runImageOnlyLocalSqlPreflight } from '../scripts/image-only-d1-preflight.mjs';

const root=new URL('../migrations/',import.meta.url).pathname;

test('exactly image migrations 0012 and 0016 are admitted after the 11 base migrations',()=>{
 const plan=inspectImageMigrationPlan(root);
 assert.equal(plan.readOnlyProduction,true);
 assert.equal(plan.execution,'in_memory_sqlite_only');
 assert.equal(plan.baselineCount,11);
 assert.deepEqual(plan.imageMigrationNames,['0012_image_jobs.sql','0016_image_chat_history.sql']);
 assert.deepEqual(plan.skippedUnapprovedBillingNames,BLOCKED_BILLING_MIGRATIONS);
 assert.equal(plan.fileNames.length,13);
 for(const name of BLOCKED_BILLING_MIGRATIONS)assert.ok(!plan.fileNames.includes(name));
});

test('image-only local SQL run confirms credits, ownership constraints and no billing tables',()=>{
 const result=runImageOnlyLocalSqlPreflight(root);
 assert.equal(result.safe,true);
 assert.equal(result.productionMutated,false);
 assert.equal(result.creditReserveAndRefundVerified,true);
 assert.equal(result.ownerForeignKeysVerified,true);
 assert.equal(result.excludedBillingMigrations,3);
 assert.deepEqual(result.imageMigrations,IMAGE_MIGRATION_ALLOWLIST);
});

test('missing image script or changed synthetic billing migration filenames fail closed',()=>{
 const tmp=mkdtempSync(join(tmpdir(),'bor-image-preflight-'));
 try{
   cpSync(root,tmp,{recursive:true});
   rmSync(join(tmp,'0016_image_chat_history.sql'));
   assert.throws(()=>inspectImageMigrationPlan(tmp),/Missing expected image/);
   writeFileSync(join(tmp,'0016_image_chat_history.sql'),readFileSync(join(root,'0016_image_chat_history.sql'),'utf8'));
   rmSync(join(tmp,'0013_billing_foundation.sql'));
   assert.throws(()=>inspectImageMigrationPlan(tmp),/Missing expected image\/billing/);
 }finally{rmSync(tmp,{recursive:true,force:true});}
});

test('image D1 preflight contains no Cloudflare remote/apply commands or calls',()=>{
 const script=readFileSync(new URL('../scripts/image-only-d1-preflight.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(script,/(?:wrangler\s+.*d1\s+execute|d1\s+migrations\s+apply|fetch\s*\(|https:\/\/api\.cloudflare\.com)/i);
 assert.match(script,/DatabaseSync\(':memory:'\)/);
 const remaining=readdirSync(root).filter(name=>/^00(?:12|13|14|15|16)_/.test(name)).sort();
 assert.deepEqual(remaining,[
   '0012_image_jobs.sql','0013_billing_foundation.sql','0014_billing_invoice_reference_guard.sql',
   '0015_billing_sandbox_invoice_recovery.sql','0016_image_chat_history.sql'
 ]);
});
