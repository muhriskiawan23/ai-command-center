// READ-ONLY receipt audit for one explicitly owner-triggered *new* D1 backup.
// Run ID is the separate GitHub manual trigger run, never this audit's run.
// No SQL download, no provider step outputs, no R2 writes, no D1 operations.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const CF_ACCOUNT='1698b70193eb133044e9fb07e39b7740';
export const BACKUP_WORKFLOW_NAME='bor-ai-chat-private-backup-v1';
export const BUCKET='bor-ai-chat-private-backups';
export const FIRST_FAILED_RUN=45090501363;
const MIN_NEW_RUN=45094020360;
const MAX_BYTES=64*1024*1024;
const STATES=new Set(['queued','running','paused','errored','terminated',
  'complete','waitingForPause','waiting','rollingBack']);

export function newBackupInstanceFromRun(runId) {
  if(typeof runId!=='string'||!/^[1-9][0-9]{9,14}$/.test(runId)||
     !Number.isSafeInteger(Number(runId))||Number(runId)<=MIN_NEW_RUN||
     Number(runId)===FIRST_FAILED_RUN)
    throw Error('backup_new_receipt_invalid_trigger_run_id');
  return 'bor-ai-private-backup-'+runId+'-1';
}
export function expectedKeysFromStartedAt(runId,startTime){
  const instance=newBackupInstanceFromRun(runId);
  if(typeof startTime!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(startTime))
    throw Error('backup_new_receipt_start_date_missing');
  const ms=Date.parse(startTime);
  if(!Number.isFinite(ms))throw Error('backup_new_receipt_start_date_invalid');
  // Export step may start shortly before or after UTC midnight.
  // Only check exact object names in these three UTC dates, never whole bucket.
  const days=[-1,0,1].map(delta=>new Date(ms+delta*86400000)
    .toISOString().slice(0,10));
  return [...new Set(days.map(day=>'private/bor-ai-chat/'+day+'/'+instance+'.sql'))];
}
export function summarizeNewBackupReceipt(workflow,objects,runId){
  newBackupInstanceFromRun(runId);
  if(!workflow||typeof workflow!=='object'||!STATES.has(workflow.status))
    throw Error('backup_new_receipt_workflow_status_invalid');
  const status=workflow.status;
  const terminal=['complete','errored','terminated'].includes(status);
  if(!terminal){
    return Object.freeze({workflowStatus:status,workflowFinished:false,
      exactPrivateR2ObjectFound:false,metadataValidated:false,
      backupMetadataReceiptVerified:false,backupRestoreTested:false,
      chatDataRead:false,productionD1Modified:false,needsRecheck:true});
  }
  if(!Array.isArray(objects))throw Error('backup_new_receipt_r2_metadata_missing');
  const expected=new Set(expectedKeysFromStartedAt(runId,workflow.start));
  const matches=objects.filter(x=>x&&expected.has(x.key));
  if(matches.length>1)throw Error('backup_new_receipt_multiple_objects_ambiguous');
  const obj=matches[0];
  const present=Boolean(obj);
  const bytesValid=present&&Number.isSafeInteger(obj.size)&&obj.size>0&&obj.size<=MAX_BYTES;
  const metaValid=Boolean(bytesValid&&
    obj.custom_metadata?.source==='bor-ai-chat'&&
    obj.custom_metadata?.workflowInstance===newBackupInstanceFromRun(runId)&&
    obj.custom_metadata?.format==='d1-sql'&&
    obj.http_metadata?.contentType==='application/sql');
  const workflowSuccess=status==='complete'&&workflow.success===true;
  return Object.freeze({
    workflowStatus:status,workflowFinished:true,workflowReportedSuccess:workflowSuccess,
    exactPrivateR2ObjectFound:present,metadataValidated:metaValid,
    bytes:bytesValid?obj.size:null,
    backupMetadataReceiptVerified:Boolean(workflowSuccess&&metaValid),
    backupRestoreTested:false,zeroDataLossProven:false,
    chatDataRead:false,productionD1Modified:false,needsRecheck:false
  });
}
async function cfGet(path,token,fetcher,stage){
  let resp;
  try{
    resp=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+CF_ACCOUNT+path,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Authorization:'Bearer '+token,Accept:'application/json'}
    });
  }catch{throw Error('backup_new_receipt_'+stage+'_network_error');}
  if(!resp.ok)throw Error('backup_new_receipt_'+stage+'_http_'+resp.status);
  let data;
  try{data=await resp.json();}catch{throw Error('backup_new_receipt_'+stage+'_invalid_json');}
  if(data?.success!==true||data.result===null||data.result===undefined)
    throw Error('backup_new_receipt_'+stage+'_api_error');
  return data;
}
export async function inspectNewBackupReceipt(env,{fetcher=fetch}={}){
  const runId=env.BOR_BACKUP_TRIGGER_RUN_ID;
  const instance=newBackupInstanceFromRun(runId);
  if(env.GITHUB_REPOSITORY!=='muhriskiawan23/ai-command-center'||
     env.GITHUB_REF!=='refs/heads/main'||
     env.CLOUDFLARE_ACCOUNT_ID!==CF_ACCOUNT||
     env.BOR_BACKUP_RECEIPT_AUDIT_APPROVED!=='AUDIT_ONLY_NO_EXPORT'||
     typeof env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN!=='string'||
     env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN.length<20||
     typeof env.CLOUDFLARE_R2_AUDIT_TOKEN!=='string'||
     env.CLOUDFLARE_R2_AUDIT_TOKEN.length<20)
    throw Error('backup_new_receipt_not_authorized');
  const data=await cfGet('/workflows/'+BACKUP_WORKFLOW_NAME+'/instances/'+instance+'?simple=true',
    env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN,fetcher,'workflow');
  const wf=data.result;
  if(!wf||!STATES.has(wf.status))
    throw Error('backup_new_receipt_workflow_status_invalid');
  if(!['complete','errored','terminated'].includes(wf.status))
    return summarizeNewBackupReceipt(wf,null,runId);
  const keys=expectedKeysFromStartedAt(runId,wf.start);
  const found=[];
  for(const key of keys){
    const data=await cfGet('/r2/buckets/'+BUCKET+'/objects?prefix='+
      encodeURIComponent(key)+'&per_page=10',
      env.CLOUDFLARE_R2_AUDIT_TOKEN,fetcher,'r2_metadata');
    if(!Array.isArray(data.result)||data.result_info?.is_truncated===true)
      throw Error('backup_new_receipt_r2_list_ambiguous');
    // Store only exact matching metadata in memory and print no private keys.
    found.push(...data.result.filter(item=>item?.key===key));
  }
  return summarizeNewBackupReceipt(wf,found,runId);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  inspectNewBackupReceipt(process.env).then(
    report=>{
      console.log('Exact new backup instance, Workflow/R2 metadata ONLY:',
        JSON.stringify(report));
      if(!report.backupMetadataReceiptVerified)process.exitCode=2;
    },
    error=>{
      console.error('New backup metadata receipt INCOMPLETE:',String(error?.message||'unknown'));
      process.exitCode=1;
    }
  );
}
