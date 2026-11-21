// Local-only image migration safety preflight. NEVER uses Cloudflare credentials,
// Wrangler's --remote flag, or production D1. Changes are made to in-memory SQLite.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IMAGE_MIGRATION_ALLOWLIST = Object.freeze(['0012_image_jobs.sql','0016_image_chat_history.sql']);
export const BLOCKED_BILLING_MIGRATIONS = Object.freeze([
  '0013_billing_foundation.sql',
  '0014_billing_invoice_reference_guard.sql',
  '0015_billing_sandbox_invoice_recovery.sql'
]);
const baseNames = Array.from({length:11},(_,i)=>String(i+1).padStart(4,'0')+'_');
const quoted = value => "'" + String(value).replaceAll("'","''") + "'";

export function inspectImageMigrationPlan(dir) {
  const files=readdirSync(dir).filter(name=>/^[0-9]{4}_.+\.sql$/.test(name)).sort();
  const baseline=baseNames.map(prefix=>files.filter(name=>name.startsWith(prefix)));
  if(baseline.some(v=>v.length!==1))throw Error('Missing/ambiguous baseline D1 migration 0001-0011');
  for(const name of [...IMAGE_MIGRATION_ALLOWLIST,...BLOCKED_BILLING_MIGRATIONS])
    if(files.filter(value=>value===name).length!==1)throw Error('Missing expected image/billing migration '+name);
  if(files.filter(name=>name.startsWith('0012_')).length!==1||
     files.filter(name=>name.startsWith('0016_')).length!==1)
    throw Error('Ambiguous image migration name');
  const selected=[...baseline.map(v=>v[0]),...IMAGE_MIGRATION_ALLOWLIST];
  if(selected.some(name=>/billing|duitku|payment/i.test(name)))throw Error('Financial migration entered allowlist');
  return Object.freeze({
    readOnlyProduction:true,execution:'in_memory_sqlite_only',
    baselineCount:baseline.length,imageMigrationNames:[...IMAGE_MIGRATION_ALLOWLIST],
    skippedUnapprovedBillingNames:[...BLOCKED_BILLING_MIGRATIONS],
    fileNames: selected
  });
}

export function runImageOnlyLocalSqlPreflight(dir) {
  const plan=inspectImageMigrationPlan(dir);
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('PRAGMA foreign_keys=ON;');
    for(const name of plan.fileNames)db.exec(readFileSync(join(dir,name),'utf8'));
    const rows=db.prepare("SELECT name,type FROM sqlite_master WHERE type IN ('table','trigger','index')").all();
    const names=new Set(rows.map(row=>row.name));
    const expected=['users','conversations','image_wallets','image_jobs','image_credit_ledger',
      'image_reserve','image_reserve_debit','image_refund','image_grant','image_jobs_by_conversation'];
    if(expected.some(name=>!names.has(name)))throw Error('Missing expected image schema or trigger');
    if(rows.some(row=>/^billing_|^duitku_|^billing$|^sandbox_/i.test(row.name)))
      throw Error('Unexpected synthetic billing object in image-only schema');
    const columns=db.prepare('PRAGMA table_info(image_jobs)').all();
    if(columns.filter(c=>c.name==='conversation_id').length!==1)throw Error('Missing image conversation ownership column');
    db.exec("INSERT INTO users(id,email,name,picture,created_at,updated_at) VALUES('u','u@example.test','','',1,1)");
    db.exec("INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES('chat','u','test',1,1)");
    db.exec("INSERT INTO image_wallets(user_id,balance,updated_at) VALUES('u',100,1)");
    db.exec("INSERT INTO image_jobs(id,user_id,request_id,request_hash,mode,prompt,model,output_format,size,status,credits,tariff_version,created_at,updated_at,expires_at,conversation_id) VALUES('job','u','req','hash','generate','Buat gambar','synthetic','png','1024x1024','queued',10,'test',1,1,99999,'chat')");
    const wallet=db.prepare("SELECT balance FROM image_wallets WHERE user_id='u'").get();
    const ledger=db.prepare("SELECT delta,event FROM image_credit_ledger WHERE job_id='job'").all();
    if(wallet?.balance!==90||ledger.length!==1||ledger[0].delta!==-10||ledger[0].event!=='reserve')
      throw Error('Image credit reservation did not debit atomically');
    db.exec("UPDATE image_jobs SET status='failed',updated_at=2 WHERE id='job'");
    const refunded=db.prepare("SELECT balance FROM image_wallets WHERE user_id='u'").get();
    const events=db.prepare("SELECT event,delta FROM image_credit_ledger WHERE job_id='job' ORDER BY id").all();
    if(refunded?.balance!==100||events.length!==2||events[1].event!=='refund'||events[1].delta!==10)
      throw Error('Image credit refund did not balance');
    const fk=db.prepare('PRAGMA foreign_key_check').all();
    if(fk.length)throw Error('Foreign key violations');
    return Object.freeze({safe:true,productionMutated:false,
      baselineMigrationCount:plan.baselineCount,imageMigrations:plan.imageMigrationNames,
      excludedBillingMigrations:plan.skippedUnapprovedBillingNames.length,
      imageTablesAndTriggersVerified:true,ownerForeignKeysVerified:true,
      creditReserveAndRefundVerified:true});
  }finally{db.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const report=runImageOnlyLocalSqlPreflight(resolve('migrations'));
    console.log(JSON.stringify(report,null,2));
  }catch(error){
    console.error('Image-only local D1 preflight BLOCKED:',error.message);
    process.exitCode=1;
  }
}
