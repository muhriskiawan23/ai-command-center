import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyImageResourcePreflight} from '../scripts/verify-image-resource-preflight.mjs';
const ENV={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'synthetic-general',CLOUDFLARE_R2_AUDIT_TOKEN:'synthetic-r2'};
const ok=result=>Response.json({success:true,result});
function fake({publicManaged=false,customDomains=[],retentionAge=604800,bucketName='bor-ai-images',
  queue=true,denied=null}={}){
  const requests=[];
  const fetcher=async(url,opts)=>{
    const path=new URL(url).pathname.replace(/^\/client\/v4\/accounts\/a{32}/,'')+new URL(url).search;
    requests.push({path,method:opts.method,auth:opts.headers.Authorization});
    if(path===denied)return new Response('',{status:403});
    if(path==='/r2/buckets/bor-ai-images')return ok({name:bucketName});
    if(path.endsWith('/domains/managed'))return ok({enabled:publicManaged});
    if(path.endsWith('/domains/custom'))return ok({domains:customDomains});
    if(path.endsWith('/lifecycle'))return ok({rules:[{id:'bor-image-retention',enabled:true,conditions:{prefix:'images/'},deleteObjectsTransition:{condition:{type:'Age',maxAge:retentionAge}}}]});
    if(path==='/queues?per_page=100&page=1')return ok(queue?[{queue_name:'bor-ai-image-jobs'}]:[]);
    throw Error('Unexpected synthetic request: '+path);
  };
  return {fetcher,requests};
}
test('read-only image resource preflight verifies private R2 and explicit seven-day lifecycle',async()=>{
 const h=fake();const report=await verifyImageResourcePreflight({env:ENV,fetcher:h.fetcher});
 assert.deepEqual(report,{readOnly:true,privateBucketVerified:true,retentionDays:7,queueVerified:true,createdResources:0,changedResources:0});
 assert.equal(h.requests.length,5);
 assert.ok(h.requests.every(r=>r.method==='GET'));
 assert.ok(h.requests.filter(x=>x.path.startsWith('/r2/')).every(x=>x.auth==='Bearer synthetic-r2'));
 assert.ok(h.requests.filter(x=>x.path.startsWith('/queues')).every(x=>x.auth==='Bearer synthetic-general'));
 assert.doesNotMatch(JSON.stringify(report),/synthetic|a{32}/);
});
test('R2 privacy, missing Queue, bad lifecycle, missing bucket and denied GET all fail closed',async()=>{
 for(const opts of [
  {publicManaged:true},{customDomains:[{domain:'public.example.test'}]},
  {retentionAge:604801},{bucketName:'untrusted-bucket'},{queue:false},
  {denied:'/r2/buckets/bor-ai-images'}
 ]){
   const h=fake(opts);
   await assert.rejects(verifyImageResourcePreflight({env:ENV,fetcher:h.fetcher}),/image_/);
   assert.ok(h.requests.every(r=>r.method==='GET'));
 }
});
test('incomplete Queue pagination cannot be mistaken for a safe resource inventory',async()=>{
 const visited=[];
 const fetcher=async(url,opts)=>{
  const u=new URL(url);visited.push(opts.method);
  if(u.pathname.endsWith('/r2/buckets/bor-ai-images'))return ok({name:'bor-ai-images'});
  if(u.pathname.endsWith('/domains/managed'))return ok({enabled:false});
  if(u.pathname.endsWith('/domains/custom'))return ok({domains:[]});
  if(u.pathname.endsWith('/lifecycle'))return ok({rules:[{id:'bor-image-retention',enabled:true,conditions:{prefix:'images/'},deleteObjectsTransition:{condition:{type:'Age',maxAge:604800}}}]});
  if(u.pathname.endsWith('/queues'))return ok(Array.from({length:100},(_,i)=>({queue_name:'different-'+i})));
  throw Error('unexpected');
 };
 await assert.rejects(verifyImageResourcePreflight({env:ENV,fetcher}),/image_queue_unverified/);
 assert.equal(visited.length,14);
 assert.ok(visited.every(x=>x==='GET'));
});
test('general deployment rejects accidental images and no longer calls provisioning automatically',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/bor-ai-deploy.yml',import.meta.url),'utf8');
 assert.match(workflow,/enable_image_pilot:[\s\S]*?default: false/);
 assert.match(workflow,/IMAGE_PILOT_RELEASE_APPROVED/);
 assert.match(workflow,/CONFIRM_BOR_AI_IMAGE_PILOT_RELEASE/);
 assert.match(workflow,/apply_db_migrations/);
 assert.match(workflow,/node scripts\/verify-image-resource-preflight\.mjs/);
 assert.match(workflow,/node scripts\/verify-image-schema-pending\.mjs [^\n]+--expect-none/);
 assert.doesNotMatch(workflow,/^\s*node scripts\/provision-image-resources\.mjs\s*$/m);
 assert.match(workflow,/PRESERVE_ACTIVE_READER/);
 assert.match(workflow,/ALLOW_READER_SHUTDOWN/);
});
test('resource verifier does not mutate accounts, provision or read secrets from file',()=>{
 const source=readFileSync(new URL('../scripts/verify-image-resource-preflight.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\b(?:POST|PUT|PATCH|DELETE|wrangler|secret put|migrations apply)\b/);
 assert.match(source,/method:'GET'/);
});
