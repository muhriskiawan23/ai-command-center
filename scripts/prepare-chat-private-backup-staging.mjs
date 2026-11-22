// Generates ONLY a dedicated backup Workflow Worker, never the active BOR AI
// chat Worker. Offline CI uses safe-OFF config and cannot export real data.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PINNED_D1_ID} from '../src/bor-chat-private-backup-core.js';

export const PRIVATE_BUCKET='bor-ai-chat-private-backups';
export const WORKFLOW_NAME='bor-ai-chat-private-backup-v1';
export function makePrivateBackupConfig(root,env={}){
  if(root?.name!=='ai-command-center'||root.d1_databases?.length!==1||
     root.d1_databases[0].database_name!=='bor-ai-chat'||
     root.d1_databases[0].database_id!==PINNED_D1_ID)
    throw Error('backup_source_production_d1_pin_mismatch');
  const approved=env.BOR_PRIVATE_BACKUP_RELEASE_APPROVED===
    'DEPLOY_ISOLATED_BOR_CHAT_PRIVATE_BACKUP_WORKFLOW';
  const account=approved?env.CLOUDFLARE_ACCOUNT_ID:'ACCOUNT_NOT_CONFIGURED';
  const host=approved?env.BOR_PRIVATE_BACKUP_SIGNED_HOST:'HOST_NOT_REVIEWED';
  if(approved&&(!/^[0-9a-f]{32}$/i.test(account||'')||
     !/^[a-z0-9.-]+\.r2\.cloudflarestorage\.com$/.test(host||'')||
     env.BOR_PRIVATE_BACKUP_BUCKET_REVIEWED!==PRIVATE_BUCKET))
    throw Error('backup_release_preflight_not_approved');
  const config={
    '$schema':'node_modules/wrangler/config-schema.json',
    name:'bor-ai-chat-backup-isolated',
    main:'src/bor-chat-private-backup-worker.js',
    compatibility_date:'2026-11-23',
    workers_dev:false,
    vars:{
      BOR_BACKUP_ENABLED:approved?'true':'false',
      BOR_BACKUP_OWNER_APPROVED:approved?'true':'false',
      BOR_BACKUP_ACCOUNT_ID:account,
      BOR_BACKUP_DATABASE_ID:PINNED_D1_ID,
      BOR_SIGNED_EXPORT_HOST:host
    },
    workflows:[{name:WORKFLOW_NAME,
      binding:'BOR_PRIVATE_CHAT_BACKUP',class_name:'BorChatPrivateBackupWorkflow'}],
    r2_buckets:[{binding:'PRIVATE_BACKUP_BUCKET',bucket_name:PRIVATE_BUCKET}]
  };
  if(config.name===root.name||config.main===root.main||
     config.d1_databases||config.assets||config.routes||config.route||
     config.queues||config.ai||config.triggers)
    throw Error('backup_worker_must_remain_independent_and_manual');
  return config;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const output=process.argv[2]||'wrangler.chat-private-backup.generated.jsonc';
    if(output==='wrangler.jsonc')throw Error('do_not_overwrite_main_config');
    const root=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
    const config=makePrivateBackupConfig(root,process.env);
    writeFileSync(output,JSON.stringify(config,null,2)+'\n',{flag:'w',mode:0o600});
    console.log(JSON.stringify({name:config.name,manual:true,
      backupEnabled:config.vars.BOR_BACKUP_ENABLED,
      workflow:WORKFLOW_NAME,privateBucket:PRIVATE_BUCKET,
      customerDataExported:false,workerDeployed:false}));
  }catch(error){console.error('BLOCKED private backup config:',error.message);process.exitCode=1;}
}
