// GET-only diagnosis of exactly one already-errored Cloudflare Workflow.
// Never surface REST response bodies, step outputs, params, tokens, bookmarks,
// R2 object keys, user SQL, signed URLs, or provider error strings to logs.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export const ACCOUNT='1698b70193eb133044e9fb07e39b7740';
export const WORKFLOW='bor-ai-chat-private-backup-v1';
export const INSTANCE='bor-ai-private-backup-45090501363-1';
const ERROR_CODES=/\bprivate_backup_[a-z0-9_]{4,80}\b/;
const SAFE_STEPS=new Map([
  ['start pinned D1 private export','start_private_export'],
  ['poll private D1 export and stream to private R2','poll_export_and_r2_store']
]);
const SAFE_STATUS=new Set(['queued','running','paused','errored','terminated','complete','waitingForPause','waiting','rollingBack']);
export function classifyProviderError(value) {
  if(!value||typeof value!=='object')return 'no_error_detail';
  const name=typeof value.name==='string'?value.name:'';
  const message=typeof value.message==='string'?value.message:'';
  const matched=message.match(ERROR_CODES);
  if(matched)return matched[0]; // Exact BOR-generated categorical error; no payload.
  if(/permission|unauthoriz|forbidden|access denied|\b403\b|\b401\b/i.test(message))
    return 'provider_permission_denied';
  if(/limit exceeded|cpu time|memory|resource limit|size limit/i.test(message))
    return 'provider_resource_limit';
  if(/missing.*(binding|secret)|binding.*(missing|undefined)/i.test(message))
    return 'provider_binding_or_secret_missing';
  if(/timed out|timeout/i.test(message))
    return 'provider_timeout';
  if(/fetch failed|network|connection refused|socket hang up/i.test(message))
    return 'provider_network_error';
  if(/TypeError/i.test(name)||/TypeError/i.test(message))
    return 'provider_type_error';
  if(/ReferenceError/i.test(name)||/ReferenceError/i.test(message))
    return 'provider_reference_error';
  return 'provider_error_redacted';
}
export function safeWorkflowDiagnostic(result) {
  if(!result||typeof result!=='object'||!SAFE_STATUS.has(result.status))
    throw Error('private_backup_diagnose_bad_status');
  const steps=Array.isArray(result.steps)?result.steps:[];
  const safeSteps=[];
  for(const step of steps){
    if(!step||typeof step!=='object')continue;
    const label=SAFE_STEPS.get(step.name);
    if(!label)continue; // Do not print unreviewed names; they might contain data.
    const attempts=Array.isArray(step.attempts)?step.attempts:[];
    const errors=attempts.map(x=>classifyProviderError(x?.error))
      .filter(x=>x!=='no_error_detail');
    const status=typeof step.status==='string'&&SAFE_STATUS.has(step.status)
      ?step.status:'unrecognized';
    safeSteps.push({step:label,status,attemptCount:attempts.length,
      failureCategories:[...new Set(errors)].slice(0,3)});
  }
  return Object.freeze({workflowStatus:result.status,instanceFailureCategory:
    classifyProviderError(result.error),stepCount:Number.isSafeInteger(result.step_count)
      ?result.step_count:null,steps:safeSteps,
    backupCompleted:result.status==='complete',
    privateR2ReceiptVerified:false,customerSQLRead:false,
    exportRetried:false,mutationsPerformed:false});
}
export async function diagnoseErroredBackupInstance(env,{fetcher=fetch}={}) {
  if(env.GITHUB_REPOSITORY!=='muhriskiawan23/ai-command-center'||
     env.GITHUB_REF!=='refs/heads/main'||
     env.CLOUDFLARE_ACCOUNT_ID!==ACCOUNT||
     env.BOR_BACKUP_RECEIPT_AUDIT_APPROVED!=='AUDIT_ONLY_NO_EXPORT'||
     typeof env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN!=='string'||
     env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN.length<20)
    throw Error('private_backup_diagnose_not_authorized');
  let response;
  try {
    response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT+
      '/workflows/'+WORKFLOW+'/instances/'+INSTANCE+'?simple=false&order=asc',{
        method:'GET',redirect:'error',signal:AbortSignal.timeout(25000),
        headers:{Authorization:'Bearer '+env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN,
          Accept:'application/json'}
      });
  } catch {throw Error('private_backup_diagnose_network_unavailable');}
  if(!response.ok)throw Error('private_backup_diagnose_http_'+response.status);
  let data;
  try{data=await response.json();}
  catch{throw Error('private_backup_diagnose_invalid_json');}
  if(data?.success!==true||!data.result)throw Error('private_backup_diagnose_api_rejected');
  return safeWorkflowDiagnostic(data.result);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  diagnoseErroredBackupInstance(process.env).then(
    report=>console.log('Sanitized Cloudflare Workflow diagnosis:',JSON.stringify(report)),
    error=>{console.error('Cloudflare Workflow diagnostic unavailable:',String(error.message||'unavailable'));
      process.exitCode=1;}
  );
}
