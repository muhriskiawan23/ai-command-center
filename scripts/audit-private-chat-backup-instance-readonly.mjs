// GET-only Cloudflare Workflow + R2 metadata audit for the EXACT single
// owner-approved 2026-11-23 private chat backup instance. No SQL or bytes read.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const BACKUP_ACCOUNT='1698b70193eb133044e9fb07e39b7740';
export const BACKUP_WORKFLOW='bor-ai-chat-private-backup-v1';
export const BACKUP_BUCKET='bor-ai-chat-private-backups';
export const BACKUP_INSTANCE='bor-ai-private-backup-45090501363-1';
export const BACKUP_UTC_DAY='2026-11-23';
export const BACKUP_KEY='private/bor-ai-chat/'+BACKUP_UTC_DAY+'/'+BACKUP_INSTANCE+'.sql';
const MAX_BYTES=64*1024*1024;
const VALID_STATUSES=new Set(['queued','running','paused','errored','terminated','complete','waitingForPause','waiting','rollingBack']);
const token=x=>typeof x==='string'&&x.length>20;

export function metadataReceipt(workflow,objects) {
  if(!workflow||typeof workflow!=='object'||!VALID_STATUSES.has(workflow.status))
    throw Error('private_backup_receipt_workflow_state_invalid');
  if(workflow.status!=='complete') {
    return Object.freeze({workflowStatus:workflow.status,workflowComplete:false,
      privateR2ObjectVerified:false,sourceD1NeverRestored:true,customerSQLRead:false});
  }
  if(workflow.success!==true)throw Error('private_backup_receipt_workflow_not_successful');
  if(!Array.isArray(objects))throw Error('private_backup_receipt_object_list_unavailable');
  const matches=objects.filter(x=>x?.key===BACKUP_KEY);
  if(matches.length!==1)throw Error('private_backup_receipt_private_object_missing_or_duplicate');
  const object=matches[0];
  if(!Number.isSafeInteger(object.size)||object.size<1||object.size>MAX_BYTES)
    throw Error('private_backup_receipt_object_size_invalid');
  if(object.custom_metadata?.workflowInstance!==BACKUP_INSTANCE ||
     object.custom_metadata?.source!=='bor-ai-chat' ||
     object.custom_metadata?.format!=='d1-sql' ||
     object.http_metadata?.contentType!=='application/sql')
    throw Error('private_backup_receipt_object_metadata_not_verified');
  return Object.freeze({workflowStatus:'complete',workflowComplete:true,
    privateR2ObjectVerified:true,bytes:object.size,
    metadataSourceVerified:true,metadataInstanceVerified:true,
    sourceD1NeverRestored:true,customerSQLRead:false,
    verifiedByCloudflareRESTGET:true,restoreTested:false,
    postCheckpointJournalNotProven:true});
}
export async function inspectPrivateBackupReceipt(env,{fetcher=fetch}={}) {
  if(env.GITHUB_REPOSITORY!=='muhriskiawan23/ai-command-center' ||
     env.GITHUB_REF!=='refs/heads/main' ||
     env.CLOUDFLARE_ACCOUNT_ID!==BACKUP_ACCOUNT ||
     env.BOR_BACKUP_RECEIPT_AUDIT_APPROVED!=='AUDIT_ONLY_NO_EXPORT' ||
     !token(env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN) ||
     !token(env.CLOUDFLARE_R2_AUDIT_TOKEN))
    throw Error('private_backup_receipt_not_authorized');
  const root='https://api.cloudflare.com/client/v4/accounts/'+BACKUP_ACCOUNT;
  const get=async(path,bearer,stage)=>{
    let resp;
    try {
      resp=await fetcher(root+path,{
        method:'GET',redirect:'error',signal:AbortSignal.timeout(30000),
        headers:{Authorization:'Bearer '+bearer,Accept:'application/json'}
      });
    } catch { throw Error('private_backup_receipt_'+stage+'_network_unavailable'); }
    if(!resp.ok)throw Error('private_backup_receipt_'+stage+'_http_'+resp.status);
    let body;
    try{body=await resp.json();}catch{throw Error('private_backup_receipt_'+stage+'_invalid_json');}
    if(body?.success!==true||body.result===null||body.result===undefined)
      throw Error('private_backup_receipt_'+stage+'_cloudflare_rejected');
    return body;
  };
  // simple=true prevents returning per-step provider output, which might
  // otherwise include object keys or provider diagnostics. Never log the response.
  const wf=await get('/workflows/'+BACKUP_WORKFLOW+'/instances/'+BACKUP_INSTANCE+'?simple=true',
    env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN,'workflow');
  const status=wf.result;
  if(status.status!=='complete')
    return metadataReceipt(status,null);
  // Exact object-key prefix, not a full-bucket scan, GET only; JSON metadata
  // (size, content-type, custom metadata) rather than the private SQL body.
  const objects=await get('/r2/buckets/'+BACKUP_BUCKET+'/objects?prefix='+
    encodeURIComponent(BACKUP_KEY)+'&per_page=10',
    env.CLOUDFLARE_R2_AUDIT_TOKEN,'r2_metadata');
  if(!Array.isArray(objects.result)||objects.result_info?.is_truncated===true)
    throw Error('private_backup_receipt_object_listing_ambiguous');
  return metadataReceipt(status,objects.result);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  inspectPrivateBackupReceipt(process.env).then(
    r=>{console.log('Cloudflare backup instance / private R2 metadata audit:',JSON.stringify(r));
      if(!r.privateR2ObjectVerified)process.exitCode=2;},
    e=>{console.error('Cloudflare backup metadata audit INCOMPLETE:',String(e?.message||'unknown'));
      process.exitCode=1;}
  );
}
