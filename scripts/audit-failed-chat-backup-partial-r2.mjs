// GET-only listing of the EXACT old failed backup object's metadata.
// A failed Cloudflare Workflow is NOT proof that a partial R2 object does not exist.
import {BACKUP_ACCOUNT,BACKUP_INSTANCE,BACKUP_BUCKET,BACKUP_KEY}
  from './audit-private-chat-backup-instance-readonly.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const CAP=64*1024*1024;
export function assessFailedBackupObjectList(data) {
  if(data?.success!==true||!Array.isArray(data.result)||
     data.result_info?.is_truncated===true)
    throw Error('private_backup_partial_object_list_unverifiable');
  const exact=data.result.filter(o=>o?.key===BACKUP_KEY);
  if(exact.length>1)throw Error('private_backup_partial_duplicate_object');
  if(exact.length===0)return Object.freeze({
    privateR2ListReadable:true,exactExpectedObjectPresent:false,
    expectedObjectMetadataValid:false,backupCompletionUnproven:true,
    readOnly:true,sqlRead:false,productionD1Queried:false
  });
  const object=exact[0];
  const sizeValid=Number.isSafeInteger(object.size)&&object.size>0&&object.size<=CAP;
  const metadataValid=sizeValid&&
    object.custom_metadata?.source==='bor-ai-chat'&&
    object.custom_metadata?.workflowInstance===BACKUP_INSTANCE&&
    object.custom_metadata?.format==='d1-sql'&&
    object.http_metadata?.contentType==='application/sql';
  return Object.freeze({
    privateR2ListReadable:true,exactExpectedObjectPresent:true,
    expectedObjectMetadataValid:metadataValid,
    bytes:sizeValid?object.size:null,
    backupCompletionUnproven:true,readOnly:true,sqlRead:false,productionD1Queried:false
  });
}
export async function auditFailedBackupPartialR2(env,{fetcher=fetch}={}) {
  if(env.GITHUB_REPOSITORY!=='muhriskiawan23/ai-command-center'||
     env.GITHUB_REF!=='refs/heads/main'||
     env.CLOUDFLARE_ACCOUNT_ID!==BACKUP_ACCOUNT||
     env.BOR_BACKUP_RECEIPT_AUDIT_APPROVED!=='AUDIT_ONLY_NO_EXPORT'||
     typeof env.CLOUDFLARE_R2_AUDIT_TOKEN!=='string'||
     env.CLOUDFLARE_R2_AUDIT_TOKEN.length<20)
    throw Error('private_backup_partial_audit_not_authorized');
  const url='https://api.cloudflare.com/client/v4/accounts/'+BACKUP_ACCOUNT+
    '/r2/buckets/'+BACKUP_BUCKET+'/objects?prefix='+encodeURIComponent(BACKUP_KEY)+'&per_page=10';
  let response;
  try {
    response=await fetcher(url,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(25000),
      headers:{Authorization:'Bearer '+env.CLOUDFLARE_R2_AUDIT_TOKEN,
        Accept:'application/json'}
    });
  }catch{throw Error('private_backup_partial_metadata_request_unavailable');}
  if(!response.ok)throw Error('private_backup_partial_metadata_http_'+response.status);
  let data;
  try{data=await response.json();}catch{throw Error('private_backup_partial_metadata_bad_json');}
  return assessFailedBackupObjectList(data);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  auditFailedBackupPartialR2(process.env).then(
    r=>console.log('Old failed backup exact-R2-object metadata ONLY:',JSON.stringify(r)),
    e=>{console.error('Old failed backup partial-object audit unavailable:',String(e?.message||'unknown'));
      process.exitCode=1;}
  );
}
