// Deterministic, OFFLINE proof that image schema is independently valid.
// Never calls Cloudflare, never reads production D1, never modifies migrations.
// This is NOT a production deployment or a safe-to-apply approval.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root=new URL('../migrations/',import.meta.url);
const allFiles=readdirSync(root).filter(name=>name.endsWith('.sql')).sort();
const baseNames=allFiles.filter(name=>/^(?:000[1-9]|001[01])_.*\.sql$/.test(name));
export const APPROVED_IMAGE_MIGRATIONS=Object.freeze(['0012_image_jobs.sql','0016_image_chat_history.sql']);

export function proveIsolatedImageSchema(){
  if(baseNames.length!==11||!/^0001_/.test(baseNames[0])||!/^0011_/.test(baseNames.at(-1)))
    throw Error('Unexpected base migrations; manual review required');
  const sqlite=new DatabaseSync(':memory:');
  try{
    sqlite.exec('PRAGMA foreign_keys = ON');
    for(const name of [...baseNames,...APPROVED_IMAGE_MIGRATIONS]){
      if(!/^(?:000[1-9]|001[0126])_.*\.sql$/.test(name))
        throw Error('Nonimage or synthetic billing migration is not permitted');
      const sql=readFileSync(new URL(name,root),'utf8');
      if(/\b(?:billing_[a-z0-9_]*|duitku|synthetic_test|sandbox_payment_url|payment_verified)\b/i.test(sql))
        throw Error('Financial or synthetic billing SQL cannot be included');
      sqlite.exec(sql);
    }
    const names=sqlite.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index','trigger')").all().map(r=>r.name);
    const exists=name=>names.includes(name);
    for(const required of ['image_jobs','image_wallets','image_credit_ledger','image_reserve','image_reserve_debit','image_refund','image_grant','image_jobs_by_conversation'])
      if(!exists(required))throw Error('Image-only schema is incomplete');
    const cols=sqlite.prepare('PRAGMA table_info(image_jobs)').all().map(r=>r.name);
    if(!cols.includes('conversation_id'))throw Error('Chat association column is missing');
    if(names.some(name=>name.startsWith('billing_')||name.startsWith('duitku_')))
      throw Error('Billing objects appeared in isolated image migration');
    return {offline:true,canApplyToProduction:false,baseMigrationsChecked:baseNames.length,
      isolatedMigrations:[...APPROVED_IMAGE_MIGRATIONS],imageSchemaValid:true,
      billingMigrationsApplied:0,d1TimeTravelBookmark:'not_verified',productionChanges:false};
  }finally{sqlite.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(JSON.stringify(proveIsolatedImageSchema(),null,2)+'\n');}
  catch(error){console.error('Image-only offline D1 preflight blocked:',error.message);process.exitCode=1;}
}
