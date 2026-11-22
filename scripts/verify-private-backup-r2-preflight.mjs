// Read-only account-side metadata audit. NEVER fetches the backup SQL,
// secret values, object keys, customer rows, or any public application URL.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const BUCKET='bor-ai-chat-private-backups';
const RETENTION_ID='bor-chat-private-backup-retention';
const PREFIX='private/bor-ai-chat/';
const RETENTION_SECONDS=30*24*60*60;

export async function verifyPrivateBackupBucket({env=process.env,fetcher=fetch}={}){
  const account=env.CLOUDFLARE_ACCOUNT_ID;
  const token=env.CLOUDFLARE_R2_AUDIT_TOKEN||env.CLOUDFLARE_API_TOKEN;
  if(!/^[0-9a-f]{32}$/i.test(account||'')||typeof token!=='string'||!token)
    throw Error('private_backup_bucket_audit_credentials_missing');
  const base='https://api.cloudflare.com/client/v4/accounts/'+account+
    '/r2/buckets/'+BUCKET;
  const read=async(path)=>{
    let response;
    try{
      response=await fetcher(base+path,{
        method:'GET',redirect:'error',signal:AbortSignal.timeout(25000),
        headers:{Authorization:'Bearer '+token,Accept:'application/json'}
      });
    }catch{throw Error('private_backup_bucket_audit_network_error');}
    if(!response.ok)throw Error('private_backup_bucket_absent_or_permission_denied');
    let result;
    try{result=await response.json();}
    catch{throw Error('private_backup_bucket_metadata_unverifiable');}
    if(result?.success!==true||!result.result)
      throw Error('private_backup_bucket_metadata_unverifiable');
    return result.result;
  };
  const bucket=await read('');
  if(bucket.name!==BUCKET)throw Error('private_backup_bucket_wrong_identity');
  const [managed,custom,lifecycle]=await Promise.all([
    read('/domains/managed'),read('/domains/custom'),read('/lifecycle')
  ]);
  if(managed?.enabled!==false||!Array.isArray(custom?.domains)||
     custom.domains.length!==0)
    throw Error('private_backup_bucket_public_access_not_disabled');
  if(!Array.isArray(lifecycle?.rules))throw Error('private_backup_lifecycle_unverifiable');
  const matches=lifecycle.rules.filter(r=>r?.id===RETENTION_ID);
  if(matches.length!==1||matches[0].enabled!==true||
     matches[0].conditions?.prefix!==PREFIX||
     matches[0].deleteObjectsTransition?.condition?.type!=='Age'||
     matches[0].deleteObjectsTransition?.condition?.maxAge!==RETENTION_SECONDS)
    throw Error('private_backup_30_day_retention_rule_not_verified');
  return Object.freeze({readOnly:true,privateBucketVerified:true,publicDomains:0,
    retentionDays:30,bucket:BUCKET,customerDataRead:false,
    objectsListed:false,createdResources:0,changedResources:0});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  verifyPrivateBackupBucket().then(report=>console.log(JSON.stringify(report)))
    .catch(error=>{console.error('BLOCKED private D1 backup bucket:',error.message);
      process.exitCode=1;});
}
