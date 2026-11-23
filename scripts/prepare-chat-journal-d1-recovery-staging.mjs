// Source-only generator; no Cloudflare calls or paid resource creation.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROD_DB} from '../src/chat-journal-staging-d1-recovery-drill.js';
export function createConfig(runId,uuid){
  if(!/^[0-9]{8,18}$/.test(runId||'')||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(uuid||'')||
    uuid.toLowerCase()===PROD_DB)throw Error('staging_recovery_invalid_identity');
  const prod=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  if((prod.d1_databases||[]).some(x=>x.database_id?.toLowerCase()===uuid.toLowerCase()))
    throw Error('staging_recovery_production_db_forbidden');
  const name='bor-ai-journal-recovery-'+runId;
  return {
    $schema:'node_modules/wrangler/config-schema.json',
    name:'bor-ai-chat-recovery-d1-staging',
    main:'src/chat-journal-staging-d1-worker.js',
    compatibility_date:'2026-11-23',
    workers_dev:false,preview_urls:false,
    durable_objects:{bindings:[{name:'CHAT_JOURNAL',class_name:'ChatJournalDurableObject'}]},
    migrations:[{tag:'staging-d1-recovery-v1',new_sqlite_classes:['ChatJournalDurableObject']}],
    d1_databases:[{binding:'RECOVERY_D1',database_name:name,database_id:uuid}],
    workflows:[{name:'bor-ai-chat-recovery-d1-drill-v1',binding:'CLOSED_RECOVERY',class_name:'ClosedJournalD1RecoveryWorkflow'}],
    vars:{CHAT_JOURNAL_ACTIVE:'false',RECOVERY_SYNTHETIC_ONLY:'true',RECOVERY_RUN_ID:runId,
      RECOVERY_D1_NAME:name,RECOVERY_D1_UUID:uuid}
  };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [runId,uuid]=process.argv.slice(2);
    writeFileSync('wrangler.chat-journal-d1-recovery.generated.jsonc',
      JSON.stringify(createConfig(runId,uuid),null,2)+'\n');
    console.log('Wrote inert synthetic D1 recovery config (no Cloudflare changes).');
  }catch(e){console.error('BLOCKED:',e.message);process.exitCode=1;}
}
