// Read-only diagnosis for the EXACT second owner-approved production backup.
// Fetch one already-errored Workflow instance and print ONLY allowlisted
// categorical errors; no SQL, URLs, raw messages or step output in logs.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {safeWorkflowDiagnostic}
  from './diagnose-private-chat-backup-instance-readonly.mjs';
import {CF_ACCOUNT,BACKUP_WORKFLOW_NAME,newBackupInstanceFromRun}
  from './audit-private-chat-backup-new-run-readonly.mjs';

export const SECOND_BACKUP_RUN_ID='45095546441';

export function validateSecondBackupDiagnosticEnv(env) {
  if(!env||env.GITHUB_REPOSITORY!=='muhriskiawan23/ai-command-center'||
     env.GITHUB_REF!=='refs/heads/main'||
     env.CLOUDFLARE_ACCOUNT_ID!==CF_ACCOUNT||
     env.BOR_BACKUP_RECEIPT_AUDIT_APPROVED!=='AUDIT_ONLY_NO_EXPORT'||
     env.BOR_BACKUP_TRIGGER_RUN_ID!==SECOND_BACKUP_RUN_ID||
     typeof env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN!=='string'||
     env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN.length<20)
    throw Error('second_backup_diagnose_not_authorized');
  return newBackupInstanceFromRun(SECOND_BACKUP_RUN_ID);
}

export async function diagnoseSecondBackup(env,{fetcher=fetch}={}){
  const id=validateSecondBackupDiagnosticEnv(env);
  const url='https://api.cloudflare.com/client/v4/accounts/'+CF_ACCOUNT+
    '/workflows/'+BACKUP_WORKFLOW_NAME+'/instances/'+id+
    '?simple=false&order=asc';
  let response;
  try {
    response=await fetcher(url,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(25000),
      headers:{Authorization:'Bearer '+env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN,
        Accept:'application/json'}
    });
  } catch {
    throw Error('second_backup_diagnose_network_unavailable');
  }
  if(!response.ok)throw Error('second_backup_diagnose_http_'+response.status);
  let body;
  try{body=await response.json();}
  catch{throw Error('second_backup_diagnose_invalid_json');}
  if(body?.success!==true||!body.result)
    throw Error('second_backup_diagnose_api_rejected');
  // DO NOT log or serialize Cloudflare's raw response; it may contain
  // signed SQL URLs, user data, bookmarks, request inputs or private errors.
  const safe=safeWorkflowDiagnostic(body.result);
  return Object.freeze({
    ...safe,
    diagnosticsOnly:true,
    originalRawErrorsExposed:false,
    cloudflareRequests:'one_GET_only',
    sqlDownloaded:false,
    productionBackupRetried:false
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  diagnoseSecondBackup(process.env).then(
    report=>console.log('Redacted SECOND backup Workflow diagnosis:',JSON.stringify(report)),
    error=>{
      console.error('Second backup diagnosis unavailable:',String(error?.message||'unknown'));
      process.exitCode=1;
    }
  );
}
