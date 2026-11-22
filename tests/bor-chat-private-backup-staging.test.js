import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  PINNED_D1_ID,MAX_DUMP_BYTES,runPrivateBackup,verifyPrivateBackupPreflight,
  verifySignedExportUrl,verifyExportEnvelope,createPrivateBackupKey
} from '../src/bor-chat-private-backup-core.js';
import {makePrivateBackupConfig,PRIVATE_BUCKET,WORKFLOW_NAME}
  from '../scripts/prepare-chat-private-backup-staging.mjs';

const account='1698b70193eb133044e9fb07e39b7740';
const hostname='synthetic.r2.cloudflarestorage.com';
const token='SYNTHETIC-NONPRODUCTION-D1-EXPORT-TOKEN-ONLY';
const bookmark='00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683';
function fixture(){
  const written=new Map();
  const bucket={
    async put(key,body,options){
      assert.equal(options.httpMetadata.contentType,'application/sql');
      const bytes=new Uint8Array(await new Response(body).arrayBuffer());
      written.set(key,bytes);
      return {size:bytes.byteLength};
    },
    async head(key){
      const bytes=written.get(key);
      return bytes?{size:bytes.byteLength}:null;
    }
  };
  const env={
    BOR_BACKUP_ENABLED:'true',BOR_BACKUP_OWNER_APPROVED:'true',
    BOR_BACKUP_ACCOUNT_ID:account,BOR_BACKUP_DATABASE_ID:PINNED_D1_ID,
    BOR_D1_EXPORT_TOKEN:token,BOR_SIGNED_EXPORT_HOST:hostname,
    PRIVATE_BACKUP_BUCKET:bucket
  };
  const event={payload:{purpose:'owner-approved-private-backup'},
    instanceId:'staging-backup-instance_001'};
  const step={async do(name,options,fn){assert.ok(name&&!('customerContent' in options));return fn();}};
  const now=()=>new Date('2026-11-23T00:00:00.000Z');
  const poll=(data={})=>Response.json({success:true,result:{
    status:'complete',
    signed_url:'https://'+hostname+'/fake-only-synthetic.sql?signature=PRIVATE_FAKE',
    ...data
  }});
  const start=()=>Response.json({success:true,result:{at_bookmark:bookmark}});
  const dump=()=>new Response('CREATE TABLE synthetic_test(id INTEGER);\n',{
    headers:{'content-type':'application/sql','content-length':'41'}
  });
  let calls=0,exportCalls=0,downloadCalls=0;
  const fetcher=async(url,opts)=>{
    calls++;
    if(url.includes('api.cloudflare.com')){
      assert.equal(opts.method,'POST');
      assert.equal(opts.redirect,'error');
      assert.ok(opts.headers.Authorization.includes('SYNTHETIC'));
      assert.ok(!opts.body.includes('PRIVATE_FAKE'));
      exportCalls++;
      return exportCalls===1?start():poll();
    }
    downloadCalls++;
    assert.equal(opts.redirect,'error');
    assert.equal(new URL(url).hostname,hostname);
    return dump();
  };
  return {env,event,step,now,poll,start,dump,fetcher,written,
    counter:()=>({calls,exportCalls,downloadCalls})};
}
test('synthetic D1 export streams only to private R2 and returns a non-sensitive receipt',async()=>{
  const h=fixture();
  const receipt=await runPrivateBackup(h);
  const wanted='private/bor-ai-chat/2026-11-23/staging-backup-instance_001.sql';
  assert.equal(receipt.ok,true);
  assert.equal(receipt.privateR2,true);
  assert.equal(receipt.sourceD1Unchanged,true);
  assert.equal(receipt.restorePerformed,false);
  assert.equal(receipt.customerDataIncludedInOutput,false);
  assert.equal(receipt.objectKey,wanted);
  assert.equal(h.written.has(wanted),true);
  assert.equal(new TextDecoder().decode(h.written.get(wanted)).startsWith('CREATE TABLE'),true);
  assert.deepEqual(h.counter(),{calls:3,exportCalls:2,downloadCalls:1});
  const serialized=JSON.stringify(receipt);
  for(const privateValue of ['PRIVATE_FAKE','SYNTHETIC-NONPRODUCTION','CREATE TABLE',bookmark])
    assert.equal(serialized.includes(privateValue),false);
});
test('Workflow resume across midnight reuses persisted private R2 key, never creates a second backup path',async()=>{
  const h=fixture();
  let startState;
  h.step={async do(name,_config,fn){
    if(name==='start pinned D1 private export'){
      if(startState===undefined)startState=await fn();
      return startState;
    }
    return fn();
  }};
  const first=await runPrivateBackup(h);
  h.now=()=>new Date('2026-11-24T00:02:00Z');
  const afterRestart=await runPrivateBackup(h);
  assert.equal(afterRestart.objectKey,first.objectKey);
  assert.equal(h.written.size,1);
  assert.equal(afterRestart.customerDataIncludedInOutput,false);
});
test('missing approval/owner, account mismatch, bucket and export credentials stop BEFORE API calls',async()=>{
  for(const change of [
    {BOR_BACKUP_ENABLED:'false'},
    {BOR_BACKUP_OWNER_APPROVED:'false'},
    {BOR_BACKUP_ACCOUNT_ID:'another-account'},
    {BOR_BACKUP_DATABASE_ID:'not-the-primary-D1'},
    {BOR_D1_EXPORT_TOKEN:''},
    {PRIVATE_BACKUP_BUCKET:null},
    {BOR_SIGNED_EXPORT_HOST:'evil.example.net'}
  ]){
    const h=fixture();
    Object.assign(h.env,change);
    await assert.rejects(runPrivateBackup(h),/private_backup_/);
    assert.deepEqual(h.counter(),{calls:0,exportCalls:0,downloadCalls:0});
    assert.equal(h.written.size,0);
  }
});
test('manual trigger rejects unknown event payload or malicious path fragment',async()=>{
  const h=fixture();
  for(const event of [
    {...h.event,instanceId:'../../escape'},
    {...h.event,payload:{}},
    {...h.event,payload:{purpose:'owner-approved-private-backup',dump:'user-table'}},
    {payload:{purpose:'owner-approved-private-backup'},instanceId:'x'}
  ])assert.throws(()=>verifyPrivateBackupPreflight(h.env,event),/private_backup_manual_trigger_invalid/);
  assert.throws(()=>createPrivateBackupKey('../../x',new Date()),/private_backup_key_invalid/);
});
test('signed export URL requires the exact reviewed Cloudflare R2 HTTPS hostname',()=>{
  const valid='https://'+hostname+'/some/path?signature=SENSITIVE';
  assert.equal(verifySignedExportUrl(valid,hostname),valid);
  for(const raw of [
    'http://'+hostname+'/dump', 'https://localhost/dump',
    'https://evil.example.net/dump', 'https://not-'+hostname+'/dump',
    'https://'+hostname+':444/dump', 'https://user:pass@'+hostname+'/dump',
    'https://'+hostname+'/dump#frag', 'ftp://'+hostname+'/dump',
    'https://'+hostname+'.evil.net/dump'
  ])assert.throws(()=>verifySignedExportUrl(raw,hostname),/private_backup_signed_url/);
});
test('export API response errors, missing bookmark and wrong polling bookmark are rejected',()=>{
  for(const sample of [
    null, {},{success:false}, {success:true,result:{status:'error'}},
    {success:true,result:{at_bookmark:'ok'}}
  ])assert.throws(()=>verifyExportEnvelope(sample),/private_backup_export/);
  assert.throws(()=>verifyExportEnvelope({success:true,result:{
    status:'complete',at_bookmark:'different',
    signed_url:'https://'+hostname+'/dump'
  }},bookmark),/private_backup_export_bookmark_changed/);
  assert.deepEqual(verifyExportEnvelope({success:true,result:{at_bookmark:bookmark,status:'polling'}},bookmark),{status:'pending'});
});
test('official Cloudflare direct result.signed_url works when poll omits status and bookmark',()=>{
  const signed='https://'+hostname+'/backup.sql?signature=fake';
  assert.deepEqual(verifyExportEnvelope({success:true,result:{signed_url:signed}},bookmark),{
    status:'complete',signedUrl:signed
  });
  assert.deepEqual(verifyExportEnvelope({success:true,result:{}},bookmark),{status:'pending'});
  assert.throws(()=>verifyExportEnvelope({success:true,result:{status:'complete'}},bookmark),
    /private_backup_export_missing_url/);
});
test('D1 start export matches documented polling request, no speculative dump options',async()=>{
  const h=fixture();
  const original=h.fetcher;
  let started=false;
  h.fetcher=async(url,opts)=>{
    if(url.includes('api.cloudflare.com')&&!started){
      started=true;
      assert.equal(opts.body,'{"output_format":"polling"}');
    }
    return original(url,opts);
  };
  const receipt=await runPrivateBackup(h);
  assert.equal(started,true);
  assert.equal(receipt.ok,true);
});
test('a pending export is only retried inside Cloudflare, never sends SQL into job output',async()=>{
  const h=fixture();
  let polls=0;
  const original=h.fetcher;
  h.fetcher=async(url,options)=>{
    if(url.includes('api.cloudflare.com')&&options.body.includes('current_bookmark')&&polls++===0)
      return h.poll({status:'polling',signed_url:undefined});
    return original(url,options);
  };
  const step=h.step;
  h.step={async do(name,options,cb){
    if(name.startsWith('poll private')){
      await assert.rejects(cb(),/private_backup_export_pending/);
      return cb();
    }
    return step.do(name,options,cb);
  }};
  const receipt=await runPrivateBackup(h);
  assert.equal(receipt.ok,true);
  assert.equal(receipt.customerDataIncludedInOutput,false);
});
test('signed URL host mismatch and a HTML response fail without writing to R2',async()=>{
  for(const failure of ['foreign','html']){
    const h=fixture();
    const original=h.fetcher;
    h.fetcher=async(url,opts)=>{
      if(url.includes('api.cloudflare.com')&&opts.body.includes('current_bookmark')&&failure==='foreign')
        return h.poll({signed_url:'https://attacker.example.org/secret'});
      if(!url.includes('api.cloudflare.com')&&failure==='html')
        return new Response('<html>sensitive</html>',{headers:{'Content-Type':'text/html'}});
      return original(url,opts);
    };
    await assert.rejects(runPrivateBackup(h),/private_backup_/);
    assert.equal(h.written.size,0);
  }
});
test('oversized response, empty response, invalid R2 receipt and head mismatch all fail closed',async()=>{
  const h=fixture();
  h.fetcher=async(url,opts)=>url.includes('api.cloudflare.com')?
    (opts.body.includes('current_bookmark')?h.poll():h.start()):
    new Response('synthetic',{headers:{'Content-Length':String(MAX_DUMP_BYTES+1)}});
  await assert.rejects(runPrivateBackup(h),/private_backup_dump_size_out_of_bounds/);
  assert.equal(h.written.size,0);
  const bad=fixture();
  bad.env.PRIVATE_BACKUP_BUCKET.head=async()=>({size:999999});
  await assert.rejects(runPrivateBackup(bad),/private_backup_r2_head_mismatch/);
});
test('generated dry-run Workflow is disabled and isolated from live Worker/D1 bindings',()=>{
  const root=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  const generated=makePrivateBackupConfig(root);
  assert.equal(generated.name,'bor-ai-chat-backup-isolated');
  assert.equal(generated.workers_dev,false);
  assert.equal(generated.main,'src/bor-chat-private-backup-worker.js');
  assert.equal(generated.vars.BOR_BACKUP_ENABLED,'false');
  assert.equal(generated.vars.BOR_BACKUP_OWNER_APPROVED,'false');
  assert.equal(generated.workflows[0].name,WORKFLOW_NAME);
  assert.equal(generated.workflows[0].schedules,undefined);
  assert.equal(generated.r2_buckets[0].bucket_name,PRIVATE_BUCKET);
  assert.equal(generated.r2_buckets[0].binding,'PRIVATE_BACKUP_BUCKET');
  assert.equal(generated.d1_databases,undefined);
  assert.equal(generated.routes,undefined);
  assert.equal(generated.queues,undefined);
  assert.equal(generated.assets,undefined);
  assert.equal(root.vars.BOR_IMAGES_ENABLED,'false');
  const w=readFileSync('src/bor-chat-private-backup-worker.js','utf8');
  assert.match(w,/status:404/);
  assert.doesNotMatch(w,/export default[\s\S]*\bPOST\b|export default[\s\S]*\/api\/chat/);
});
test('explicit enablement needs independently reviewed bucket, correct account and exact release phrase',()=>{
  const root=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  for(const broken of [
    {BOR_PRIVATE_BACKUP_RELEASE_APPROVED:'DEPLOY_ISOLATED_BOR_CHAT_PRIVATE_BACKUP_WORKFLOW'},
    {BOR_PRIVATE_BACKUP_RELEASE_APPROVED:'DEPLOY_ISOLATED_BOR_CHAT_PRIVATE_BACKUP_WORKFLOW',
      CLOUDFLARE_ACCOUNT_ID:account,BOR_PRIVATE_BACKUP_SIGNED_HOST:hostname},
    {BOR_PRIVATE_BACKUP_RELEASE_APPROVED:'DEPLOY_ISOLATED_BOR_CHAT_PRIVATE_BACKUP_WORKFLOW',
      CLOUDFLARE_ACCOUNT_ID:'BAD',BOR_PRIVATE_BACKUP_SIGNED_HOST:hostname,
      BOR_PRIVATE_BACKUP_BUCKET_REVIEWED:PRIVATE_BUCKET}
  ])assert.throws(()=>makePrivateBackupConfig(root,broken),/backup_release_preflight_not_approved/);
  const cfg=makePrivateBackupConfig(root,{
    BOR_PRIVATE_BACKUP_RELEASE_APPROVED:'DEPLOY_ISOLATED_BOR_CHAT_PRIVATE_BACKUP_WORKFLOW',
    CLOUDFLARE_ACCOUNT_ID:account,BOR_PRIVATE_BACKUP_SIGNED_HOST:hostname,
    BOR_PRIVATE_BACKUP_BUCKET_REVIEWED:PRIVATE_BUCKET
  });
  assert.equal(cfg.vars.BOR_BACKUP_ENABLED,'true');
  assert.equal(cfg.vars.BOR_SIGNED_EXPORT_HOST,hostname);
  assert.equal(cfg.workflows[0].schedules,undefined);
});
