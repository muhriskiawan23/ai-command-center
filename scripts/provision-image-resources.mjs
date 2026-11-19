// Idempotent provisioning of the dedicated private image bucket and queue.
// Requires existing operator credentials; never logs API bodies or secret values.
const {CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:token}=process.env;
if(!/^[a-f0-9]{32}$/i.test(account||'')||!token)throw Error('Cloudflare credentials are required.');
const base='https://api.cloudflare.com/client/v4/accounts/'+account;
async function api(path,method='GET',body,allowMissing=false){
 const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000),redirect:'error'});
 if(response.status===404&&allowMissing)return null;
 const data=await response.json();
 if(!response.ok||data.success!==true)throw Error('Cloudflare image-resource request failed: '+method+' '+path.split('?')[0]+' (HTTP '+response.status+'). Check R2 and Queues permissions.');
 return data.result;
}
const bucket='/r2/buckets/bor-ai-images';
if(!await api(bucket,'GET',undefined,true))await api('/r2/buckets','POST',{name:'bor-ai-images'});
const managed=await api(bucket+'/domains/managed');
if(managed?.enabled)throw Error('Image bucket r2.dev public access must be disabled before deployment.');
const custom=await api(bucket+'/domains/custom');
if(custom?.domains?.length)throw Error('Image bucket must not have public custom domains.');
const lifecycle=await api(bucket+'/lifecycle');
const rules=(lifecycle?.rules||[]).filter(rule=>rule.id!=='bor-image-retention');
rules.push({id:'bor-image-retention',enabled:true,conditions:{prefix:'images/'},deleteObjectsTransition:{condition:{type:'Age',maxAge:7*86400}}});
await api(bucket+'/lifecycle','PUT',{rules});
let found=false;
for(let page=1;page<=100;page++){
 const queues=await api('/queues?per_page=100&page='+page);
 if(!Array.isArray(queues))throw Error('Unexpected queue inventory.');
 if(queues.some(queue=>queue.queue_name==='bor-ai-image-jobs')){found=true;break;}
 if(queues.length<100)break;
 if(page===100)throw Error('Queue inventory exceeds bounded pagination.');
}
if(!found)await api('/queues','POST',{queue_name:'bor-ai-image-jobs'});
console.log('Verified dedicated private image bucket, 7-day retention and image queue.');
