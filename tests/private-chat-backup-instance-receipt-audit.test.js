import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_ACCOUNT,BACKUP_BUCKET,BACKUP_WORKFLOW,BACKUP_INSTANCE,BACKUP_KEY,
  metadataReceipt,inspectPrivateBackupReceipt
} from '../scripts/audit-private-chat-backup-instance-readonly.mjs';

const goodObject=()=>({key:BACKUP_KEY,size:42001,
  custom_metadata:{source:'bor-ai-chat',workflowInstance:BACKUP_INSTANCE,format:'d1-sql'},
  http_metadata:{contentType:'application/sql'}});
const env=()=>({
  GITHUB_REPOSITORY:'muhriskiawan23/ai-command-center',
  GITHUB_REF:'refs/heads/main',
  CLOUDFLARE_ACCOUNT_ID:BACKUP_ACCOUNT,
  BOR_BACKUP_RECEIPT_AUDIT_APPROVED:'AUDIT_ONLY_NO_EXPORT',
  CLOUDFLARE_BACKUP_DEPLOY_TOKEN:'SYNTHETIC_ONLY_CLOUDFLARE_DEPLOY_KEY',
  CLOUDFLARE_R2_AUDIT_TOKEN:'SYNTHETIC_ONLY_CLOUDFLARE_R2_READ_KEY'
});
function fake({status='complete',objects=[goodObject()],r2Status=200}={}){
  const seen=[];
  const fetcher=async(url,opts)=>{
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.ok(!opts.body);
    const u=new URL(url);
    assert.equal(u.hostname,'api.cloudflare.com');
    assert.ok(u.pathname.startsWith('/client/v4/accounts/'+BACKUP_ACCOUNT+'/'));
    seen.push(u.pathname+u.search);
    if(u.pathname.includes('/workflows/')) {
      assert.equal(u.searchParams.get('simple'),'true');
      assert.ok(u.pathname.endsWith('/workflows/'+BACKUP_WORKFLOW+'/instances/'+BACKUP_INSTANCE));
      return Response.json({success:true,result:{status,success:status==='complete'}});
    }
    assert.equal(u.pathname,'/client/v4/accounts/'+BACKUP_ACCOUNT+'/r2/buckets/'+BACKUP_BUCKET+'/objects');
    assert.equal(u.searchParams.get('prefix'),BACKUP_KEY);
    assert.equal(u.searchParams.get('per_page'),'10');
    return Response.json({success:r2Status===200,result:objects,
      result_info:{is_truncated:false}},{status:r2Status});
  };
  return {fetcher,seen};
}
test('only exact completed Cloudflare instance plus matching private SQL object metadata counts as receipt',async()=>{
  const f=fake();
  const receipt=await inspectPrivateBackupReceipt(env(),{fetcher:f.fetcher});
  assert.deepEqual({complete:receipt.workflowComplete,object:receipt.privateR2ObjectVerified,bytes:receipt.bytes,
    sqlRead:receipt.customerSQLRead,restore:receipt.restoreTested},
    {complete:true,object:true,bytes:42001,sqlRead:false,restore:false});
  assert.equal(f.seen.length,2);
});
test('running instance does not contact R2 and is never marked as a completed backup',async()=>{
  const f=fake({status:'running'});
  const receipt=await inspectPrivateBackupReceipt(env(),{fetcher:f.fetcher});
  assert.equal(receipt.privateR2ObjectVerified,false);
  assert.equal(receipt.workflowStatus,'running');
  assert.equal(f.seen.length,1);
});
test('errored Workflow instance remains non-successful',async()=>{
  const f=fake({status:'errored'});
  const receipt=await inspectPrivateBackupReceipt(env(),{fetcher:f.fetcher});
  assert.equal(receipt.privateR2ObjectVerified,false);
  assert.equal(receipt.workflowStatus,'errored');
});
test('success requires exact object path size and provenance custom metadata',()=>{
  assert.throws(()=>metadataReceipt({status:'complete',success:true},[]),/object_missing/);
  for(const bad of [
    {...goodObject(),size:0},
    {...goodObject(),size:70000000},
    {...goodObject(),key:'private/bor-ai-chat/another.sql'},
    {...goodObject(),custom_metadata:{...goodObject().custom_metadata,source:'unreviewed'}},
    {...goodObject(),custom_metadata:{...goodObject().custom_metadata,workflowInstance:'other'}},
    {...goodObject(),http_metadata:{contentType:'application/json'}}
  ])assert.throws(()=>metadataReceipt({status:'complete',success:true},[bad]),/private_backup_receipt_/);
  assert.throws(()=>metadataReceipt({status:'complete',success:false},[goodObject()]),/not_successful/);
});
test('R2 403 or missing metadata fails without downloading content or triggering export',async()=>{
  const f=fake({r2Status:403});
  await assert.rejects(inspectPrivateBackupReceipt(env(),{fetcher:f.fetcher}),/r2_metadata_http_403/);
  assert.equal(f.seen.length,2);
  assert.ok(f.seen.every(x=>!x.includes('/export')&&!x.includes('/query')));
});
test('wrong account, wrong branch, missing credentials, or unknown consent blocks before any GET',async()=>{
  for(const modification of [
    {GITHUB_REF:'refs/heads/other'},
    {GITHUB_REPOSITORY:'another/repo'},
    {CLOUDFLARE_ACCOUNT_ID:'not_this_account'},
    {BOR_BACKUP_RECEIPT_AUDIT_APPROVED:'oops'},
    {CLOUDFLARE_BACKUP_DEPLOY_TOKEN:''},
    {CLOUDFLARE_R2_AUDIT_TOKEN:''}
  ]){
    let requests=0;
    await assert.rejects(
      inspectPrivateBackupReceipt({...env(),...modification},
        {fetcher:async()=>{requests++;throw Error('not authorized');}}),
      /not_authorized/);
    assert.equal(requests,0);
  }
});
