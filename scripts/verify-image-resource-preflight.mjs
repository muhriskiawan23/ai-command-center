// Image production release: metadata-only R2 and Queue verification.
// No provisioning, mutation, secret printing, provider inference, or Worker deploy.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const BUCKET='bor-ai-images', QUEUE='bor-ai-image-jobs';
const RETENTION_SECONDS=7*24*60*60;
export async function verifyImageResourcePreflight({env=process.env,fetcher=fetch}={}){
  const account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
  if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw Error('image_resource_credentials_unavailable');
  const base='https://api.cloudflare.com/client/v4/accounts/'+account;
  const read=async(path,r2=false)=>{
    const credential=r2?(env.CLOUDFLARE_R2_AUDIT_TOKEN||token):token;
    const response=await fetcher(base+path,{method:'GET',
      headers:{Authorization:'Bearer '+credential,Accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(25000)});
    if(!response.ok)throw Error('image_resource_readonly_check_failed');
    const payload=await response.json();
    if(payload?.success!==true||payload.result==null)throw Error('image_resource_unverifiable');
    return payload.result;
  };
  const bucket=await read('/r2/buckets/'+BUCKET,true);
  if(bucket?.name!==BUCKET)throw Error('image_bucket_unverified');
  const managed=await read('/r2/buckets/'+BUCKET+'/domains/managed',true);
  const custom=await read('/r2/buckets/'+BUCKET+'/domains/custom',true);
  if(managed?.enabled!==false||!Array.isArray(custom?.domains)||custom.domains.length!==0)
    throw Error('image_bucket_must_have_no_public_domains');
  const lifecycle=await read('/r2/buckets/'+BUCKET+'/lifecycle',true);
  const rules=lifecycle?.rules;
  if(!Array.isArray(rules)||rules.filter(rule=>rule?.id==='bor-image-retention').length!==1)
    throw Error('image_retention_rule_unverified');
  const rule=rules.find(x=>x.id==='bor-image-retention');
  if(rule.enabled!==true||rule.conditions?.prefix!=='images/'||
     rule.deleteObjectsTransition?.condition?.type!=='Age'||
     rule.deleteObjectsTransition?.condition?.maxAge!==RETENTION_SECONDS)
    throw Error('image_retention_rule_unverified');
  let count=0,complete=false;
  for(let page=1;page<=10;page++){
    const list=await read('/queues?per_page=100&page='+page);
    if(!Array.isArray(list)||list.length>100)throw Error('image_queue_inventory_unverifiable');
    count+=list.filter(x=>x?.queue_name===QUEUE).length;
    if(list.length<100){complete=true;break;}
  }
  if(!complete||count!==1)throw Error('image_queue_unverified');
  return Object.freeze({readOnly:true,privateBucketVerified:true,
    retentionDays:7,queueVerified:true,createdResources:0,changedResources:0});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  verifyImageResourcePreflight().then(report=>{
    process.stdout.write(JSON.stringify(report)+'\n');
  }).catch(error=>{
    console.error('BLOCKED: Image resource launch verification failed:',error.message);
    process.exitCode=1;
  });
}
