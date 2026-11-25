import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  REVIEWED_MIGRATIONS,
  createFullSchemaSyntheticFixture,
  fingerprintFullSyntheticSchema,
  runFullSchemaSyntheticSqliteRestoreDrill
} from '../tools/recovery/full-schema-synthetic-sqlite-recovery.mjs';

const get=(db,sql,...args)=>db.prepare(sql).get(...args);

test('ALL 14 checked-in migrations restore exact synthetic user, sessions, integer IDs, feedback FK, link sources and image associations',async()=>{
  const out=await runFullSchemaSyntheticSqliteRestoreDrill();
  assert.equal(out.passed,true);
  assert.equal(out.temporaryFilesDeleted,true);
  assert.equal(out.migrationCount,14);
  assert.ok(out.tableCount>=15);
  assert.ok(out.indexCount>=15);
  assert.ok(out.triggerCount>=4);
  assert.match(out.sha256,/^[0-9a-f]{64}$/);
  assert.equal(out.originalIntegerMessageIdsPreserved,true);
  assert.equal(out.syntheticSessionRowsPreserved,true);
  assert.equal(out.syntheticLinkSourcesPreserved,true);
  assert.equal(out.syntheticImageAssociationPreserved,true);
  assert.equal(out.foreignKeysValid,true);
  assert.equal(out.syntheticOnly,true);
  assert.equal(out.cloudflareCalled,false);
  assert.equal(out.productionD1Touched,false);
  assert.equal(out.checkpointRpoProven,false);
  assert.equal(out.originalRealUserDataProven,false);
  assert.equal(out.cloudflareSqlExportProven,false);
});

test('full-schema fixture fingerprints deterministic schema, rows, SQLite sequence and real image DB triggers',()=>{
  assert.deepEqual(REVIEWED_MIGRATIONS.map(x=>x.split('_')[0]),
    ['0001','0002','0003','0004','0005','0006','0007','0008',
      '0009','0010','0011','0012','0016','0017']);
  const db=createFullSchemaSyntheticFixture();
  try{
    const first=fingerprintFullSyntheticSchema(db);
    assert.ok(first.tableCount>=15);
    for(const table of ['users','sessions','conversations','messages','answer_feedback',
      'user_memories','user_settings','public_api_keys','github_connections',
      'github_oauth_states','daily_usage','search_provider_usage','web_search_v2_usage','image_jobs',
      'image_wallets','image_credit_ledger','image_pilot_meter']){
      assert.ok(first.rowCounts[table]>0,'Missing full-schema synthetic row: '+table);
    }
    assert.equal(first.rowCounts.messages,4);
    assert.equal(get(db,'SELECT message_id FROM answer_feedback WHERE id=91').message_id,1002);
    assert.equal(get(db,'SELECT balance FROM image_wallets WHERE user_id=?','synthetic-owner-only').balance,6);
    assert.equal(get(db,'SELECT admitted_count FROM image_pilot_meter WHERE singleton=1').admitted_count,1);
    db.prepare('UPDATE messages SET content=? WHERE id=1002').run('SYNTHETIC_TAMPERED_ONLY');
    const after=fingerprintFullSyntheticSchema(db);
    assert.notEqual(after.sha256,first.sha256,'Row tampering must change full backup fingerprint');
  }finally{db.close();}
});

test('real ON DELETE cascade and image job SET NULL survive referential integrity under synthetic erasure',()=>{
  const db=createFullSchemaSyntheticFixture();
  try{
    db.prepare('DELETE FROM conversations WHERE id=? AND user_id=?')
      .run('synthetic-chat-one','synthetic-owner-only');
    assert.equal(get(db,'SELECT COUNT(*) AS n FROM messages WHERE id IN (1001,1002)').n,0);
    assert.equal(get(db,'SELECT COUNT(*) AS n FROM answer_feedback').n,0);
    assert.equal(get(db,'SELECT conversation_id FROM image_jobs WHERE id=?','synthetic-image-job').conversation_id,null);
    assert.equal(get(db,'SELECT balance FROM image_wallets WHERE user_id=?','synthetic-owner-only').balance,6);
    assert.equal(get(db,'SELECT admitted_count FROM image_pilot_meter WHERE singleton=1').admitted_count,1);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    db.prepare('DELETE FROM users WHERE id=?').run('synthetic-owner-only');
    assert.equal(get(db,'SELECT COUNT(*) AS n FROM sessions').n,0);
    assert.equal(get(db,'SELECT COUNT(*) AS n FROM image_jobs').n,0);
    assert.equal(get(db,'SELECT COUNT(*) AS n FROM image_credit_ledger').n,0);
    assert.equal(get(db,'SELECT COUNT(*) AS n FROM github_connections').n,0);
    assert.equal(get(db,'SELECT COUNT(*) AS n FROM user_memories').n,0);
    assert.equal(get(db,'SELECT COUNT(*) AS n FROM public_api_keys').n,0);
    assert.equal(get(db,'SELECT COUNT(*) AS n FROM users').n,1); // second owner unaffected
    assert.equal(get(db,'SELECT admitted_count FROM image_pilot_meter WHERE singleton=1').admitted_count,1);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{db.close();}
});

test('integrity gate rejects a foreign-key violation even when schema itself looks intact',()=>{
  const db=createFullSchemaSyntheticFixture();
  try{
    db.exec('PRAGMA foreign_keys=OFF');
    db.prepare('UPDATE answer_feedback SET message_id=? WHERE id=91').run(999999);
    db.exec('PRAGMA foreign_keys=ON');
    assert.throws(()=>fingerprintFullSyntheticSchema(db),/full_schema_drill_foreign_key_violation/);
  }finally{db.close();}
});

test('full-schema drill cannot connect to Cloudflare, open production DB or export contents to CI artifacts',()=>{
  const script=readFileSync('tools/recovery/full-schema-synthetic-sqlite-recovery.mjs','utf8');
  assert.match(script,/new DatabaseSync\(':memory:'\)/);
  assert.match(script,/mkdtempSync/);
  assert.match(script,/rmSync\(folder,\{recursive:true,force:true\}\)/);
  assert.match(script,/backup\(source,file\)/);
  assert.doesNotMatch(script,/https:\/\/api\.cloudflare\.com|wrangler deploy|BOR_PRIVATE_D1_EXPORT_TOKEN|CLOUDFLARE_API_TOKEN|\.\/*\.\/wrangler\.jsonc|execFile|spawn\(/);
  assert.doesNotMatch(script,/console\.log|writeFileSync|process\.env/);
});
