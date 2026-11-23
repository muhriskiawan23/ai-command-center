// Strictly synthetic enabled-shape build: used for release-candidate dry-runs.
// No Cloudflare token, user data, production D1 query, Worker deployment,
// export trigger or R2 write is permitted here.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {makePrivateBackupConfig,PRIVATE_BUCKET,WORKFLOW_NAME}
  from './prepare-chat-private-backup-staging.mjs';

export const CANDIDATE_PATH='wrangler.chat-private-backup.candidate.generated.jsonc';
export const SYNTHETIC_SIGNED_HOST='candidate-only.r2.cloudflarestorage.com';
export const SYNTHETIC_ACCOUNT_ID='00000000000000000000000000000000';

export function buildPrivateBackupReleaseCandidate(root){
  // Explicit literal-only values, not process.env: accidental live credentials
  // must never flow into a CI dry-run artifact.
  const cfg=makePrivateBackupConfig(root,{
    BOR_PRIVATE_BACKUP_RELEASE_APPROVED:
      'DEPLOY_ISOLATED_BOR_CHAT_PRIVATE_BACKUP_WORKFLOW',
    BOR_PRIVATE_BACKUP_BUCKET_REVIEWED:PRIVATE_BUCKET,
    CLOUDFLARE_ACCOUNT_ID:SYNTHETIC_ACCOUNT_ID,
    BOR_PRIVATE_BACKUP_SIGNED_HOST:SYNTHETIC_SIGNED_HOST
  });
  if(cfg.name!=='bor-ai-chat-backup-isolated'||
     cfg.main!=='src/bor-chat-private-backup-worker.js'||
     cfg.vars?.BOR_BACKUP_ENABLED!=='true'||
     cfg.vars?.BOR_BACKUP_OWNER_APPROVED!=='true'||
     cfg.vars?.BOR_BACKUP_ACCOUNT_ID!==SYNTHETIC_ACCOUNT_ID||
     cfg.vars?.BOR_SIGNED_EXPORT_HOST!==SYNTHETIC_SIGNED_HOST||
     cfg.workers_dev!==false||
     cfg.workflows?.length!==1||
     cfg.workflows[0].name!==WORKFLOW_NAME||
     cfg.workflows[0].schedules||
     cfg.r2_buckets?.length!==1||
     cfg.r2_buckets[0].bucket_name!==PRIVATE_BUCKET||
     cfg.d1_databases||cfg.routes||cfg.route||cfg.triggers||
     cfg.assets||cfg.queues||cfg.ai||
     'BOR_D1_EXPORT_TOKEN' in cfg.vars||
     'BOR_PRIVATE_D1_EXPORT_TOKEN' in cfg.vars)
    throw Error('private_backup_candidate_isolation_unverified');
  return cfg;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const root=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
    const cfg=buildPrivateBackupReleaseCandidate(root);
    writeFileSync(CANDIDATE_PATH,JSON.stringify(cfg,null,2)+'\n',
      {flag:'w',mode:0o600});
    console.log('Private backup release candidate: isolated, synthetic, enabled-shaped, dry-run ONLY; no real Cloudflare credentials or backup operations.');
  }catch{
    console.error('BLOCKED: private backup candidate isolation failed');
    process.exitCode=1;
  }
}
