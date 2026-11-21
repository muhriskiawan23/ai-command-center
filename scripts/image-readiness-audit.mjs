// Read-only BOR AI Image Assistant infrastructure inventory.
// No migrations, provider inference, resource creation, or secret-value logging.
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const worker='ai-command-center';
const imageBucket='bor-ai-images';
const imageQueue='bor-ai-image-jobs';
const statusFor=entries=>{
  if (!Array.isArray(entries)) return 'unverifiable';
  return entries.length===1?'present':entries.length===0?'absent':'ambiguous';
};
const named=(bindings,name)=>bindings.filter(b=>b?.name===name);
const textBinding=(bindings,name)=>{
  const entries=named(bindings,name);
  return entries.length===1 && entries[0].type==='plain_text' && typeof entries[0].text==='string' ? entries[0].text : null;
};
const secretState=(bindings,name)=>{
  const entries=named(bindings,name);
  return entries.length===1?(entries[0].type==='secret_text'?'present':'unexpected_type'):statusFor(entries);
};
const resourceState=(bindings,name,type)=>{
  const entries=named(bindings,name);
  return entries.length===1?(entries[0].type===type?'present':'unexpected_type'):statusFor(entries);
};

export function summarizeImageReadiness({bindings,activeTraffic,publicHealth,mediaLabStatus,imageConfig,inventory}){
  if (!Array.isArray(bindings)) throw Error('Active Worker bindings not verifiable');
  const reader=textBinding(bindings,'URL_READER_ENABLED');
  const quota=textBinding(bindings,'TAVILY_EXTRACT_DAILY_URL_LIMIT');
  const tavily=textBinding(bindings,'URL_READER_PROVIDER');
  const readerPreservable=reader==='true'&&tavily==='tavily'&&/^[1-9][0-9]?$/.test(quota||'')&&Number(quota)<=8&&secretState(bindings,'TAVILY_API_KEY')==='present';
  const features={
    productionHealth:publicHealth===true?'pass':'unverifiable',
    mediaLabDeployed:mediaLabStatus===200?'yes':mediaLabStatus===404?'no':'unverifiable',
    paidImagesLive:imageConfig?.enabled===false?'off':imageConfig?.enabled===true?'on':'unverifiable',
    activeWorkerTraffic:activeTraffic===100?'verified_100_percent':'unverifiable',
    readerState:reader==='true'?'on':reader==='false'?'off':'unverifiable',
    readerPreservationPreflight:readerPreservable?'metadata_compatible_security_review_required':'not_verified',
    imageSecretBound:secretState(bindings,'OPENAI_API_KEY'),
    imageFilesBound:resourceState(bindings,'IMAGE_FILES','r2_bucket'),
    imageQueueBound:resourceState(bindings,'IMAGE_QUEUE','queue'),
    chatImageHistoryFlag:textBinding(bindings,'BOR_IMAGE_CHAT_HISTORY_ENABLED')==='true'?'on':'off_or_unverifiable',
    dedicatedR2Bucket:inventory?.bucket||'unverifiable',
    privateR2Domains:inventory?.privacy||'unverifiable',
    dedicatedImageQueue:inventory?.queue||'unverifiable',
    databaseMigration:'not_checked_requires_reviewed_schema_and_time_travel_bookmark',
    urlReaderProviderSecurity:'pending_independent_review_issues_156_351'
  };
  const blockers=[];
  if(features.mediaLabDeployed!=='yes')blockers.push('local_media_assets_not_deployed');
  if(features.paidImagesLive!=='on')blockers.push('paid_image_feature_off');
  if(features.imageSecretBound!=='present')blockers.push('image_api_secret_not_bound');
  if(features.imageFilesBound!=='present'||features.imageQueueBound!=='present')blockers.push('active_worker_missing_image_bindings');
  if(features.dedicatedR2Bucket!=='present'||features.privateR2Domains!=='verified_private'||features.dedicatedImageQueue!=='present')blockers.push('image_storage_queue_not_proven_private_ready');
  blockers.push('migration_and_openai_billing_review_pending');
  if(features.readerState==='on')blockers.push('reader_provider_security_review_pending_before_preserving_release');
  if(features.activeWorkerTraffic!=='verified_100_percent')blockers.push('active_worker_version_unverified');
  return {readOnlyAudit:true,productionLaunchReady:false,features,blockers};
}

async function runAudit({fetcher=fetch,env=process.env}={}){
  const account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
  if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw Error('Missing production Cloudflare audit credentials');
  const base='https://api.cloudflare.com/client/v4/accounts/'+account;
  const request=async(path,{allow404=false}={})=>{
    const response=await fetcher(base+path,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(response.status===404&&allow404)return null;
    if(!response.ok)throw Error('Cloudflare read-only audit could not verify a required endpoint (HTTP '+response.status+')');
    const payload=await response.json();
    if(payload.success!==true)throw Error('Cloudflare read-only audit returned failure');
    return payload.result;
  };
  const deployed=await request('/workers/scripts/'+worker+'/deployments?per_page=1');
  const versions=deployed?.deployments?.[0]?.versions;
  if(!Array.isArray(versions)||versions.length!==1||versions[0].percentage!==100||!versions[0].version_id)
    throw Error('Cannot identify one 100%-active Cloudflare Worker version');
  const version=await request('/workers/scripts/'+worker+'/versions/'+encodeURIComponent(versions[0].version_id));
  const bindings=version?.resources?.bindings;
  if(!Array.isArray(bindings))throw Error('Cannot inspect active Worker binding names/types');
  const publicBase='https://ai-command-center.muhriskiawan23.workers.dev';
  const publicGet=async(path)=>{
    try {const response=await fetcher(publicBase+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000)});return {status:response.status,data:response.ok?await response.json().catch(()=>null):null};}
    catch{return {status:null,data:null};}
  };
  const health=await publicGet('/api/health?deep=1');
  const img=await publicGet('/api/images/config');
  let mediaLabStatus=null;
  try {const res=await fetcher(publicBase+'/media-lab.html',{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000)});mediaLabStatus=res.status;}
  catch{}
  let bucket='unverifiable',privacy='unverifiable',queue='unverifiable';
  try {
    const found=await request('/r2/buckets/'+imageBucket,{allow404:true});
    bucket=found?'present':'absent';
    if(found){
      const [managed,custom]=await Promise.all([
        request('/r2/buckets/'+imageBucket+'/domains/managed'),
        request('/r2/buckets/'+imageBucket+'/domains/custom')
      ]);
      if(managed && typeof managed.enabled==='boolean' && Array.isArray(custom?.domains))
        privacy=!managed.enabled&&custom.domains.length===0?'verified_private':'public_or_unverifiable';
    }
  }catch{bucket='unverifiable';}
  try {
    let found=false,complete=false;
    for(let page=1;page<=10;page++){
      const list=await request('/queues?per_page=100&page='+page);
      if(!Array.isArray(list))throw Error('Unverifiable queue inventory');
      if(list.some(x=>x?.queue_name===imageQueue)){found=true;complete=true;break;}
      if(list.length<100){complete=true;break;}
    }
    queue=found?'present':complete?'absent':'unverifiable';
  }catch{queue='unverifiable';}
  return summarizeImageReadiness({
    bindings,activeTraffic:versions[0].percentage,
    publicHealth:health.status===200&&health.data?.ok===true&&health.data?.checks?.database===true,
    mediaLabStatus,imageConfig:img.data,inventory:{bucket,privacy,queue}
  });
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAudit().then(report=>{
    // Only authored enums/booleans are printed. Never log a Cloudflare API payload.
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }).catch(error=>{console.error('Read-only image readiness audit inconclusive:',error.message);process.exitCode=1;});
}
