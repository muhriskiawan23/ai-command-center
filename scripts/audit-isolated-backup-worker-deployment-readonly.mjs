// GET-only Cloudflare Workers deployment metadata audit.
// Reads exact isolated backup Worker deployment IDs only; never downloads
// script bundles, secrets, D1 data, SQL, R2 objects or workflow instances.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const ISOLATED_BACKUP_WORKER='bor-ai-chat-backup-isolated';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function inspectIsolatedBackupDeployment({env=process.env,fetcher=fetch}={}){
  const account=env.CLOUDFLARE_ACCOUNT_ID;
  const token=env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN;
  if(!/^[0-9a-f]{32}$/i.test(account||'')||
     typeof token!=='string'||!token)
    throw Error('isolated_backup_audit_credentials_missing');
  const url='https://api.cloudflare.com/client/v4/accounts/'+account+
    '/workers/scripts/'+ISOLATED_BACKUP_WORKER+'/deployments?page=1&per_page=1';
  let response;
  try{
    response=await fetcher(url,{method:'GET',redirect:'error',
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(20000)});
  }catch{
    throw Error('isolated_backup_audit_network_unavailable');
  }
  if(!response.ok)throw Error('isolated_backup_audit_http_unavailable');
  let json;
  try{json=await response.json();}
  catch{throw Error('isolated_backup_audit_invalid_json');}
  const deployments=json?.result?.deployments;
  if(json?.success!==true||!Array.isArray(deployments)||
     deployments.length!==1)
    throw Error('isolated_backup_audit_missing_deployment');
  const d=deployments[0];
  if(!UUID.test(d?.id||'')||!Number.isFinite(Date.parse(d?.created_on))||
     !Array.isArray(d.versions)||d.versions.length<1||d.versions.length>2)
    throw Error('isolated_backup_audit_invalid_deployment');
  const versions=d.versions.map(v=>{
    if(!UUID.test(v?.version_id||'')||typeof v.percentage!=='number'||
       !Number.isFinite(v.percentage)||v.percentage<=0||v.percentage>100)
      throw Error('isolated_backup_audit_invalid_version');
    return {versionId:v.version_id,percentage:v.percentage};
  });
  if(Math.abs(versions.reduce((sum,v)=>sum+v.percentage,0)-100)>0.001)
    throw Error('isolated_backup_audit_invalid_split');
  return Object.freeze({
    worker:ISOLATED_BACKUP_WORKER,
    activeDeploymentId:d.id,
    createdAt:d.created_on,
    versions,
    readOnly:true,
    sourceCodeVerified:false, // Deployment metadata alone cannot prove PR #415 is installed.
    backupCompleted:false,
    exportTriggered:false,
    productionDataRead:false,
    mutationsPerformed:false
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  inspectIsolatedBackupDeployment().then(report=>console.log(JSON.stringify(report)))
    .catch(error=>{
      // Error strings are local fixed allowlisted constants. Never print response bodies.
      console.error('BLOCKED isolated backup read-only audit:',error.message);
      process.exitCode=1;
    });
}
