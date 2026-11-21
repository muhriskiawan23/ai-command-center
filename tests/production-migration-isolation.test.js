import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectProductionMigrations} from '../scripts/check-production-migration-isolation.mjs';
import {createD1} from './e2e/harness.js';

test('production D1 migration folder has only account/chat/image SQL, never synthetic billing',()=>{
  const directory=new URL('../migrations/',import.meta.url).pathname;
  const report=inspectProductionMigrations(directory);
  assert.equal(report.safe,true);
  assert.equal(report.blockedFiles,0);
  assert.equal(report.productionD1,'bor-ai-chat');
  const filenames=['0013_billing_foundation.sql','0014_billing_invoice_reference_guard.sql',
    '0015_billing_sandbox_invoice_recovery.sql'];
  for(const file of filenames) {
    assert.throws(()=>readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'),/ENOENT/);
    const preserved=readFileSync(new URL('../staging/billing/synthetic-reference/'+file,import.meta.url),'utf8');
    assert.ok(preserved.length>500,'Synthetic billing fixture must remain available offline');
  }
});
test('only nonfinancial chat D1 SQL is accepted for production migration dispatch',()=>{
  const root=mkdtempSync(join(tmpdir(),'bor-prod-mig-'));try{
    writeFileSync(join(root,'0001_chat.sql'),'CREATE TABLE chats (id TEXT PRIMARY KEY);');
    assert.deepEqual(inspectProductionMigrations(root),{
      safe:true,checkedFiles:1,blockedFiles:0,productionD1:'bor-ai-chat'
    });
    writeFileSync(join(root,'0002_not-obviously-billing.sql'),'CREATE TABLE billing_wallets(id TEXT);');
    assert.equal(inspectProductionMigrations(root).safe,false);
    rmSync(join(root,'0002_not-obviously-billing.sql'));
    writeFileSync(join(root,'0002_opaque.sql'),"CREATE TABLE ledger(event_type TEXT CHECK(event_type='synthetic_test'));");
    assert.equal(inspectProductionMigrations(root).safe,false);
    rmSync(join(root,'0002_opaque.sql'));
    writeFileSync(join(root,'0002_duitku.sql'),'SELECT 1;');
    assert.equal(inspectProductionMigrations(root).safe,false);
  }finally{rmSync(root,{recursive:true,force:true})}
});
test('missing, empty migration directories must fail closed',()=>{
  const root=mkdtempSync(join(tmpdir(),'bor-empty-mig-'));try{
    assert.throws(()=>inspectProductionMigrations(root),/directory_empty/);
    assert.throws(()=>inspectProductionMigrations(''),/directory_required/);
  }finally{rmSync(root,{recursive:true,force:true})}
});
test('production workflow cannot run remote D1 apply without preceding financial scan',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/bor-ai-deploy.yml',import.meta.url),'utf8');
  const scan=workflow.indexOf('node scripts/check-production-migration-isolation.mjs migrations');
  const apply=workflow.indexOf('d1 migrations apply bor-ai-chat --remote');
  assert.ok(scan>0&&apply>scan,'block must execute before remote apply');
  assert.match(workflow,/name: Reject synthetic billing migrations in production D1 directory[\s\S]*?if: \$\{\{ inputs\.apply_db_migrations \}\}/);
  assert.match(workflow,/name: Apply D1 migrations[\s\S]*?if: \$\{\{ inputs\.apply_db_migrations \}\}/);
  assert.match(workflow,/apply_db_migrations:[\s\S]*?default: false/);
});

test('image migrations can initialize a primary chat D1 with no synthetic billing tables',()=>{
  const db=createD1();
  try{
    const names=new Set(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    for(const name of ['users','conversations','image_wallets','image_jobs','image_credit_ledger'])
      assert.equal(names.has(name),true,name+' missing');
    for(const name of ['billing_quotes','billing_orders','billing_credit_ledger','billing_payment_events'])
      assert.equal(names.has(name),false,name+' must remain isolated');
    const fields=db.sqlite.prepare('PRAGMA table_info(image_jobs)').all().map(row=>row.name);
    assert.ok(fields.includes('conversation_id'),'image chat history migration 0016 must apply after 0012');
    const triggers=new Set(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row=>row.name));
    for(const name of ['image_reserve','image_reserve_debit','image_refund','image_grant'])
      assert.ok(triggers.has(name),'missing image credit guard '+name);
  }finally{db.sqlite.close()}
});
