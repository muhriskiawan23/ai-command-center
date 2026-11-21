// Read-only BOR AI Image Assistant infrastructure inventory.
// No migrations, provider inference, resource creation, or secret-value logging.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
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
    r2BucketProbe:inventory?.bucketProbe||'not_checked',
    privateR2Domains:inventory?.privacy||'unverifiable',
    r2PrivacyProbe:inventory?.privacyProbe||'not_checked',
    dedicatedImageQueue:inventory?.queue||'unverifiable',
    queueProbe:inventory?.queueProbe||'not_checked',
    pinnedProductionD1:inventory?.d1||'unverifiable',
    d1MetadataProbe:inventory?.d1Probe||'not_checked',
    d1Bookmark:inventory?.bookmark||'unverifiable',
    d1BookmarkProbe:inventory?.bookmarkProbe||'not_checked',
    databaseMigration:'not_checked_requires_reviewed_schema_and_time_travel_bookmark',
    urlReaderProviderSecurity:'pending_independent_review_issues_156_351'
  };
  const blockers=[];
  if(features.mediaLabDeployed!=='yes')blockers.push('local_media_assets_not_deployed');
  if(features.paidImagesLive!=='on')blockers.push('paid_image_feature_off');
  if(features.imageSecretBound!=='present')blockers.push('image_api_secret_not_bound');
  if(features.imageFilesBound!=='present'||features.imageQueueBound!=='present')blockers.push('active_worker_missing_image_bindings');
  if(features.dedicatedR2Bucket!=='present'||features.privateR2Domains!=='verified_private'||features.dedicatedImageQueue!=='present')blockers.push('image_storage_queue_not_proven_private_ready');
  if(features.pinnedProductionD1!=='verified') blockers.push('production_d1_identity_not_verified');
  if(features.d1Bookmark!=='available') blockers.push('production_d1_bookmark_not_verified');
  blockers.push('migration_and_openai_billing_review_pending');
  if(features.readerState==='on')blockers.push('reader_provider_security_review_pending_before_preserving_release');
  if(features.activeWorkerTraffic!=='verified_100_percent')blockers.push('active_worker_version_unverified');
  return {readOnlyAudit:true,productionLaunchReady:false,features,blockers};
}

export async function runAudit({fetcher=fetch,env=process.env}={}){
  const account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
  if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw Error('Missing production Cloudflare audit credentials');
  const base='https://api.cloudflare.com/client/v4/accounts/'+account;
  const request=async(path,{allow404=false}={})=>{
    const response=await fetcher(base+path,{method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(response.status===404&&allow404)return null;
    if(!response.ok){
      const error=new Error('Cloudflare read-only audit could not verify an endpoint');
      error.httpStatus=response.status;
      throw error;
    }
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
  const probeError=error=>{
    // Diagnostic codes only. Never print response bodies, access tokens or IDs.
    const status=error?.httpStatus;
    if(status===401||status===403)return 'denied';
    if(status===404)return 'not_found';
    if(Number.isInteger(status)&&status>=400&&status<600)return 'http_error';
    return 'unverifiable';
  };
  let bucket='unverifiable',privacy='unverifiable',queue='unverifiable',d1='unverifiable',bookmark='unverifiable';
  let bucketProbe='not_checked',privacyProbe='not_checked',queueProbe='not_checked',d1Probe='not_checked',bookmarkProbe='not_checked';
  try {
    const found=await request('/r2/buckets/'+imageBucket,{allow404:true});
    bucket=found?'present':'absent';bucketProbe='ok';
  }catch(error){bucketProbe=probeError(error);}
  if(bucket==='present'){
    try {
      const [managed,custom]=await Promise.all([
        request('/r2/buckets/'+imageBucket+'/domains/managed'),
        request('/r2/buckets/'+imageBucket+'/domains/custom')
      ]);
      if(managed && typeof managed.enabled==='boolean' && Array.isArray(custom?.domains)){
        privacy=!managed.enabled&&custom.domains.length===0?'verified_private':'public_or_unverifiable';
        privacyProbe='ok';
      } else privacyProbe='unexpected_shape';
    }catch(error){privacyProbe=probeError(error);}
  }
  try {
    let found=false,complete=false;
    for(let page=1;page<=10;page++){
      const list=await request('/queues?per_page=100&page='+page);
      if(!Array.isArray(list))throw Error('Unverifiable queue inventory');
      if(list.some(x=>x?.queue_name===imageQueue)){found=true;complete=true;break;}
      if(list.length<100){complete=true;break;}
    }
    queue=found?'present':complete?'absent':'unverifiable';queueProbe=complete?'ok':'pagination_limit';
  }catch(error){queueProbe=probeError(error);}
  try {
    // Read only the pinned production D1 metadata, never issue an SQL statement.
    const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
    const dbs=config?.d1_databases?.filter(item=>item?.binding==='DB');
    if(!Array.isArray(dbs)||dbs.length!==1||dbs[0].database_name!=='bor-ai-chat'||
       !/^[0-9a-f-]{36}$/i.test(dbs[0].database_id||'')) throw Error('Unpinned production D1');
    const db=await request('/d1/database/'+encodeURIComponent(dbs[0].database_id),{allow404:true});
    d1=db?.name===dbs[0].database_name && db?.uuid===dbs[0].database_id?'verified':db?'mismatch':'absent';
    d1Probe='ok';
    if(d1==='verified'){
      // GET bookmark existence only. Never persist, print or return its value.
      try {
        const snapshot=await request('/d1/database/'+encodeURIComponent(dbs[0].database_id)+'/time_travel/bookmark',{allow404:true});
        bookmark=snapshot && typeof snapshot.bookmark==='string' && snapshot.bookmark.trim().length>=8?'available':snapshot?'unexpected_shape':'unavailable';
        bookmarkProbe='ok';
      }catch(error){bookmarkProbe=probeError(error);}
    }
  }catch(error){d1Probe=probeError(error);}
  return summarizeImageReadiness({
    bindings,activeTraffic:versions[0].percentage,
    publicHealth:health.status===200&&health.data?.ok===true&&health.data?.checks?.database===true,
    mediaLabStatus,imageConfig:img.data,inventory:{bucket,privacy,queue,d1,bookmark,bucketProbe,privacyProbe,queueProbe,d1Probe,bookmarkProbe}
  });
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runAudit().then(report=>{
    // Only authored enums/booleans are printed. Never log a Cloudflare API payload.
    process.stdout.write(JSON.stringify(report,null,2)+'\n');
  }).catch(error=>{console.error('Read-only image readiness audit inconclusive:',error.message);process.exitCode=1;});
}
