import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { prepareImageOnlyMigrationList } from '../scripts/prepare-image-only-migration-list.mjs';
import { DatabaseSync } from 'node:sqlite';

const originalRoot=path.resolve(new URL('..',import.meta.url).pathname);
function testRoot(action){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'bor-images-only-'));
  try {
    fs.mkdirSync(path.join(root,'migrations'),{recursive:true});
    const base=JSON.parse(fs.readFileSync(path.join(originalRoot,'wrangler.jsonc'),'utf8'));
    fs.writeFileSync(path.join(root,'wrangler.jsonc'),JSON.stringify(base));
    for(const name of ['0012_image_jobs.sql','0013_billing_foundation.sql',
      '0014_billing_invoice_reference_guard.sql','0015_billing_sandbox_invoice_recovery.sql',
      '0016_image_chat_history.sql']){
      fs.copyFileSync(path.join(originalRoot,'migrations',name),path.join(root,'migrations',name));
    }
    return action(root);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('isolated listing copies ONLY reviewed image migration names; excludes 0013-0015',()=>{
  testRoot(root=>{
    const plan=prepareImageOnlyMigrationList({root});
    assert.deepEqual(plan.migrations,['0012_image_jobs.sql','0016_image_chat_history.sql']);
    assert.equal(plan.applied,false);
    assert.equal(plan.onlyListsMigrations,true);
    const folder=path.join(root,plan.generatedDir);
    assert.deepEqual(fs.readdirSync(folder).sort(),plan.migrations);
    for(const name of plan.migrations)
      assert.equal(fs.readFileSync(path.join(folder,name),'utf8'),fs.readFileSync(path.join(root,'migrations',name),'utf8'));
    const generated=JSON.parse(fs.readFileSync(path.join(root,plan.configFile),'utf8'));
    const baseline=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
    assert.equal(generated.d1_databases[0].database_id,baseline.d1_databases[0].database_id);
    assert.equal(generated.d1_databases[0].database_name,'bor-ai-chat');
    assert.equal(generated.d1_databases[0].migrations_dir,'.wrangler/image-only-migrations');
    assert.equal('main' in generated,false);
    assert.equal('assets' in generated,false);
    assert.equal('vars' in generated,false);
    assert.equal('r2_buckets' in generated,false);
    assert.equal('queues' in generated,false);
    assert.equal('secrets' in generated,false);
    assert.equal(baseline.d1_databases[0].migrations_dir,'migrations');
    assert.equal(baseline.vars.URL_READER_ENABLED,'false');
    assert.doesNotMatch(JSON.stringify(plan),new RegExp(baseline.d1_databases[0].database_id));
    assert.doesNotMatch(fs.readdirSync(folder).join(','),/billing|0013|0014|0015/);
  });
});
test('idempotent dry-run listing does not rewrite or apply any D1 schema',()=>{
  testRoot(root=>{
    const first=prepareImageOnlyMigrationList({root});
    const content=fs.readFileSync(path.join(root,first.configFile),'utf8');
    assert.deepEqual(prepareImageOnlyMigrationList({root}),first);
    assert.equal(fs.readFileSync(path.join(root,first.configFile),'utf8'),content);
  });
});
test('malicious extra migrations in generated directory block preparation',()=>{
  testRoot(root=>{
    const generated=path.join(root,'.wrangler','image-only-migrations');
    fs.mkdirSync(generated,{recursive:true});
    fs.writeFileSync(path.join(generated,'0014_billing.sql'),'SELECT 1;');
    assert.throws(()=>prepareImageOnlyMigrationList({root}),/Unexpected file/);
  });
});
test('tampering with generated 0012 image schema blocks reuse',()=>{
  testRoot(root=>{
    prepareImageOnlyMigrationList({root});
    fs.writeFileSync(path.join(root,'.wrangler/image-only-migrations/0012_image_jobs.sql'),'SELECT 1;');
    assert.throws(()=>prepareImageOnlyMigrationList({root}),/differs from its checked-in source/);
  });
});
test('the tool fails closed if image SQL or baseline contains billing or unexpected D1',()=>{
  testRoot(root=>{
    fs.appendFileSync(path.join(root,'migrations/0016_image_chat_history.sql'),'\nCREATE TABLE billing_wallets(id TEXT);\n');
    assert.throws(()=>prepareImageOnlyMigrationList({root}),/financial or synthetic billing SQL/);
  });
  testRoot(root=>{
    const cfgPath=path.join(root,'wrangler.jsonc');
    const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
    cfg.d1_databases[0].database_name='a-different-database';
    fs.writeFileSync(cfgPath,JSON.stringify(cfg));
    assert.throws(()=>prepareImageOnlyMigrationList({root}),/pin the existing production chat D1/);
  });
  testRoot(root=>{
    const cfgPath=path.join(root,'wrangler.jsonc');
    const cfg=JSON.parse(fs.readFileSync(cfgPath,'utf8'));
    cfg.vars.URL_READER_ENABLED='true';
    fs.writeFileSync(cfgPath,JSON.stringify(cfg));
    assert.throws(()=>prepareImageOnlyMigrationList({root}),/reviewed Reader-OFF repository baseline/);
  });
});
test('the ordinary production deployment still rejects mixed billing migrations and defaults to no apply',()=>{
  const workflow=fs.readFileSync(path.join(originalRoot,'.github/workflows/bor-ai-deploy.yml'),'utf8');
  const guard=workflow.indexOf('node scripts/check-production-migration-isolation.mjs migrations');
  const apply=workflow.indexOf('d1 migrations apply bor-ai-chat --remote');
  assert.ok(guard>0&&apply>guard);
  assert.match(workflow,/apply_db_migrations:[\s\S]*?default: false/);
});

test('reviewed 0012 then 0016 SQL applies locally with no synthetic billing objects',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); CREATE TABLE conversations(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id));');
    const sql12=fs.readFileSync(path.join(originalRoot,'migrations','0012_image_jobs.sql'),'utf8');
    const sql16=fs.readFileSync(path.join(originalRoot,'migrations','0016_image_chat_history.sql'),'utf8');
    db.exec(sql12);db.exec(sql16);
    const objects=db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index')").all().map(x=>x.name);
    for(const needed of ['image_wallets','image_jobs','image_credit_ledger','image_reserve','image_reserve_debit','image_refund','image_grant','image_jobs_by_conversation'])
      assert.ok(objects.includes(needed),'Missing expected image schema object: '+needed);
    assert.ok(!objects.some(name=>/^billing_|^duitku|^midtrans/.test(name)),'Generated image migration must not create billing objects');
    assert.ok(db.prepare('PRAGMA table_info(image_jobs)').all().some(x=>x.name==='conversation_id'));
  } finally{db.close();}
});
