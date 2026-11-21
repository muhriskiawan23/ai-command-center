import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeImageReadiness, runAudit } from '../scripts/image-readiness-audit.mjs';
import { readFileSync } from 'node:fs';

const bindings=[
  {name:'URL_READER_ENABLED',type:'plain_text',text:'true'},
  {name:'URL_READER_PROVIDER',type:'plain_text',text:'tavily'},
  {name:'TAVILY_EXTRACT_DAILY_URL_LIMIT',type:'plain_text',text:'4'},
  {name:'TAVILY_API_KEY',type:'secret_text',text:'not-a-real-tavily-secret'},
  {name:'OPENAI_API_KEY',type:'secret_text',text:'not-a-real-image-secret'},
  {name:'IMAGE_FILES',type:'r2_bucket',bucket_name:'bor-ai-images'},
  {name:'IMAGE_QUEUE',type:'queue',queue_name:'bor-ai-image-jobs'},
];
const defaultParams={
  bindings,activeTraffic:100,publicHealth:true,mediaLabStatus:404,
  imageConfig:{enabled:false},inventory:{bucket:'present',privacy:'verified_private',queue:'present'}
};

test('no secrets are exposed; default-off media and costs remain release blockers',()=>{
  const report=summarizeImageReadiness(defaultParams);
  assert.equal(report.readOnlyAudit,true);
  assert.equal(report.productionLaunchReady,false);
  assert.equal(report.features.productionHealth,'pass');
  assert.equal(report.features.readerState,'on');
  assert.equal(report.features.readerPreservationPreflight,'metadata_compatible_security_review_required');
  assert.equal(report.features.imageSecretBound,'present');
  assert.equal(report.features.imageFilesBound,'present');
  assert.equal(report.features.imageQueueBound,'present');
  assert.equal(report.features.mediaLabDeployed,'no');
  assert.equal(report.features.paidImagesLive,'off');
  assert.ok(report.blockers.includes('migration_and_openai_billing_review_pending'));
  assert.ok(report.blockers.includes('reader_provider_security_review_pending_before_preserving_release'));
  assert.doesNotMatch(JSON.stringify(report),/not-a-real|TAVILY_API_KEY|OPENAI_API_KEY|account-id/);
});

test('missing or mislabeled secret/resource bindings cannot be reported present',()=>{
  const changed=bindings.map(b=>b.name==='OPENAI_API_KEY'?{name:b.name,type:'plain_text',text:'leaked'}:
    b.name==='IMAGE_FILES'?{name:b.name,type:'plain_text',text:'fake'}:b);
  const report=summarizeImageReadiness({...defaultParams,bindings:changed});
  assert.equal(report.features.imageSecretBound,'unexpected_type');
  assert.equal(report.features.imageFilesBound,'unexpected_type');
  assert.ok(report.blockers.includes('active_worker_missing_image_bindings'));
  assert.ok(report.blockers.includes('image_api_secret_not_bound'));
  assert.doesNotMatch(JSON.stringify(report),/leaked|fake/);
});

test('preservation metadata rejects quota expansion and missing Tavily secret',()=>{
  const quota=bindings.map(b=>b.name==='TAVILY_EXTRACT_DAILY_URL_LIMIT'?{...b,text:'9'}:b);
  assert.equal(summarizeImageReadiness({...defaultParams,bindings:quota}).features.readerPreservationPreflight,'not_verified');
  const withoutSecret=bindings.filter(b=>b.name!=='TAVILY_API_KEY');
  assert.equal(summarizeImageReadiness({...defaultParams,bindings:withoutSecret}).features.readerPreservationPreflight,'not_verified');
  assert.throws(()=>summarizeImageReadiness({...defaultParams,bindings:null}),/not verifiable/);
});

test('read-only audit uses GET endpoints only and cannot invoke an image provider or mutate resources',async()=>{
  const calls=[];
  const ok=result=>Response.json({success:true,result});
  const fetcher=async (url,options)=>{
    calls.push({url,method:options.method});
    if(url.endsWith('/deployments?per_page=1'))return ok({deployments:[{versions:[{percentage:100,version_id:'v1'}]}]});
    if(url.endsWith('/versions/v1'))return ok({resources:{bindings}});
    if(url.endsWith('/r2/buckets/bor-ai-images'))return ok({name:'bor-ai-images'});
    if(/\/d1\/database\/[0-9a-f-]{36}\/time_travel\/bookmark$/i.test(url))return ok({bookmark:'bookmark-synthetic-123456'});
    if(/\/d1\/database\/[0-9a-f-]{36}$/i.test(url)){
      const id=url.split('/').at(-1);
      return ok({name:'bor-ai-chat',uuid:id});
    }
    if(url.endsWith('/r2/buckets/bor-ai-images/domains/managed'))return ok({enabled:false});
    if(url.endsWith('/r2/buckets/bor-ai-images/domains/custom'))return ok({domains:[]});
    if(url.includes('/queues?per_page=100&page=1'))return ok([{queue_name:'bor-ai-image-jobs'}]);
    if(url.endsWith('/api/health?deep=1'))return Response.json({ok:true,checks:{database:true}});
    if(url.endsWith('/api/images/config'))return Response.json({enabled:false});
    if(url.endsWith('/media-lab.html'))return new Response('not deployed',{status:404});
    throw Error('Unexpected external endpoint');
  };
  const report=await runAudit({fetcher,env:{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'synthetic-secret'}});
  assert.equal(report.features.privateR2Domains,'verified_private');
  assert.equal(report.features.dedicatedImageQueue,'present');
  assert.equal(report.features.imageSecretBound,'present');
  assert.equal(report.features.mediaLabDeployed,'no');
  assert.equal(report.features.pinnedProductionD1,'verified');
  assert.equal(report.features.d1MetadataProbe,'ok');
  assert.equal(report.features.d1Bookmark,'available');
  assert.equal(report.features.d1BookmarkProbe,'ok');
  assert.equal(report.features.r2BucketProbe,'ok');
  assert.equal(report.features.queueProbe,'ok');
  assert.ok(calls.length>=9);
  assert.ok(calls.every(c=>c.method==='GET'));
  assert.ok(calls.every(c=>/^https:\/\/(?:api\.cloudflare\.com|ai-command-center\.muhriskiawan23\.workers\.dev)\//.test(c.url)));
  assert.doesNotMatch(JSON.stringify(report),/synthetic-secret|not-a-real|bookmark-synthetic-123456/);
});

test('audit refuses unknown active traffic allocation and missing operator credentials',async()=>{
  await assert.rejects(runAudit({fetcher:async()=>{throw Error('Should not fetch');},env:{}}),/Missing production Cloudflare audit credentials/);
  const result=summarizeImageReadiness({...defaultParams,activeTraffic:null});
  assert.equal(result.features.activeWorkerTraffic,'unverifiable');
  assert.ok(result.blockers.includes('active_worker_version_unverified'));
});

test('R2 permission errors remain unverifiable rather than claiming bucket missing',async()=>{
  const ok=result=>Response.json({success:true,result});
  const fetcher=async(url,options)=>{
    assert.equal(options.method,'GET');
    if(url.endsWith('/deployments?per_page=1'))return ok({deployments:[{versions:[{percentage:100,version_id:'v1'}]}]});
    if(url.endsWith('/versions/v1'))return ok({resources:{bindings}});
    if(url.endsWith('/r2/buckets/bor-ai-images'))return new Response('',{status:403});
    if(url.includes('/queues?per_page=100&page=1'))return ok([]);
    if(/\/d1\/database\/[0-9a-f-]{36}$/i.test(url))return new Response('',{status:403});
    if(url.endsWith('/api/health?deep=1'))return Response.json({ok:true,checks:{database:true}});
    if(url.endsWith('/api/images/config'))return Response.json({enabled:false});
    if(url.endsWith('/media-lab.html'))return new Response('',{status:404});
    throw Error('Unexpected audit endpoint');
  };
  const report=await runAudit({fetcher,env:{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'synthetic-private-token'}});
  assert.equal(report.features.dedicatedR2Bucket,'unverifiable');
  assert.equal(report.features.r2BucketProbe,'denied');
  assert.equal(report.features.privateR2Domains,'unverifiable');
  assert.equal(report.features.pinnedProductionD1,'unverifiable');
  assert.equal(report.features.d1MetadataProbe,'denied');
  assert.equal(report.features.d1Bookmark,'unverifiable');
  assert.equal(report.features.d1BookmarkProbe,'not_checked');
  assert.equal(report.features.dedicatedImageQueue,'absent');
  assert.ok(report.blockers.includes('production_d1_identity_not_verified'));
  assert.doesNotMatch(JSON.stringify(report),/synthetic-private-token/);
});
test('an R2 bucket found via GET stays present if private domain inventory is forbidden',async()=>{
  const ok=result=>Response.json({success:true,result});
  const fetcher=async(url,options)=>{
    assert.equal(options.method,'GET');
    if(url.endsWith('/deployments?per_page=1'))return ok({deployments:[{versions:[{percentage:100,version_id:'v1'}]}]});
    if(url.endsWith('/versions/v1'))return ok({resources:{bindings}});
    if(url.endsWith('/r2/buckets/bor-ai-images'))return ok({name:'bor-ai-images'});
    if(url.includes('/r2/buckets/bor-ai-images/domains/'))return new Response('',{status:403});
    if(url.includes('/queues?per_page=100&page=1'))return ok([]);
    if(/\/d1\/database\/[0-9a-f-]{36}\/time_travel\/bookmark$/i.test(url))return ok({bookmark:'bookmark-synthetic-123456'});
    if(/\/d1\/database\/[0-9a-f-]{36}$/i.test(url)){
      const id=url.split('/').at(-1);
      return ok({name:'bor-ai-chat',uuid:id});
    }
    if(url.endsWith('/api/health?deep=1'))return Response.json({ok:true,checks:{database:true}});
    if(url.endsWith('/api/images/config'))return Response.json({enabled:false});
    if(url.endsWith('/media-lab.html'))return new Response('',{status:404});
    throw Error('Unexpected audit endpoint');
  };
  const report=await runAudit({fetcher,env:{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'synthetic-private-token'}});
  assert.equal(report.features.dedicatedR2Bucket,'present');
  assert.equal(report.features.r2BucketProbe,'ok');
  assert.equal(report.features.privateR2Domains,'unverifiable');
  assert.equal(report.features.r2PrivacyProbe,'denied');
  assert.equal(report.features.pinnedProductionD1,'verified');
  assert.equal(report.features.d1Bookmark,'available');
});

test('production diagnostics workflow lists but can never apply image or billing migrations',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/bor-ai-image-readiness.yml',import.meta.url),'utf8');
  assert.match(workflow,/d1 migrations list bor-ai-chat --remote --config wrangler\.jsonc/);
  assert.doesNotMatch(workflow,/^\s*(?:npx|wrangler)\b[^\n]*d1 migrations apply\b/m);
  assert.doesNotMatch(workflow,/^\s*(?:npx|wrangler)\b[^\n]*deploy\b/m);
  assert.doesNotMatch(workflow,/^\s*(?:npx|wrangler)\b[^\n]*d1 execute\b/m);
});

test('bookmarks without verified metadata never produce a false restoration assurance',()=>{
 const report=summarizeImageReadiness({...defaultParams,inventory:{d1:'unverifiable',bookmark:'unverifiable',bookmarkProbe:'denied'}});
 assert.equal(report.features.d1Bookmark,'unverifiable');
 assert.equal(report.features.d1BookmarkProbe,'denied');
 assert.ok(report.blockers.includes('production_d1_bookmark_not_verified'));
});
