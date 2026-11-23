import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CF_ACCOUNT,BUCKET,BACKUP_WORKFLOW_NAME,newBackupInstanceFromRun,
  expectedKeysFromStartedAt,summarizeNewBackupReceipt,inspectNewBackupReceipt
} from '../scripts/audit-private-chat-backup-new-run-readonly.mjs';

const RUN='45095556789';
const ID='bor-ai-private-backup-'+RUN+'-1';
const START='2026-11-23T01:48:25.000Z';
const goodObject=()=>({
  key:'private/bor-ai-chat/2026-11-23/'+ID+'.sql',
  size:123456,
  custom_metadata:{source:'bor-ai-chat',format:'d1-sql',workflowInstance:ID},
  http_metadata:{contentType:'application/sql'}
});
const env=()=>({
  GITHUB_REPOSITORY:'muhriskiawan23/ai-command-center',GITHUB_REF:'refs/heads/main',
  CLOUDFLARE_ACCOUNT_ID:CF_ACCOUNT,BOR_BACKUP_RECEIPT_AUDIT_APPROVED:'AUDIT_ONLY_NO_EXPORT',
  BOR_BACKUP_TRIGGER_RUN_ID:RUN,
  CLOUDFLARE_BACKUP_DEPLOY_TOKEN:'SYNTHETIC_ONLY_NONREAL_WORKFLOW_TOKEN',
  CLOUDFLARE_R2_AUDIT_TOKEN:'SYNTHETIC_ONLY_NONREAL_READ_TOKEN'
});
function fake(status='complete',objects=[goodObject()],r2Code=200){
  const calls=[];
  return {
    calls,
    fetcher:async(url,opts)=>{
      assert.equal(opts.method,'GET');
      assert.equal(opts.redirect,'error');
      assert.equal(opts.body,undefined);
      const parsed=new URL(url);
      assert.equal(parsed.hostname,'api.cloudflare.com');
      assert.ok(parsed.pathname.startsWith('/client/v4/accounts/'+CF_ACCOUNT+'/'));
      calls.push(parsed.pathname+parsed.search);
      if(parsed.pathname.includes('/workflows/')){
        assert.ok(parsed.pathname.endsWith('/workflows/'+BACKUP_WORKFLOW_NAME+'/instances/'+ID));
        assert.equal(parsed.searchParams.get('simple'),'true');
        return Response.json({success:true,result:{status,start:START,success:status==='complete'}});
      }
      assert.equal(parsed.pathname,'/client/v4/accounts/'+CF_ACCOUNT+'/r2/buckets/'+BUCKET+'/objects');
      assert.equal(parsed.searchParams.get('per_page'),'10');
      const key=parsed.searchParams.get('prefix');
      assert.ok(expectedKeysFromStartedAt(RUN,START).includes(key));
      if(r2Code!==200)return Response.json({success:false},{status:r2Code});
      return Response.json({success:true,result:objects.filter(o=>o.key===key),
        result_info:{is_truncated:false}});
    }
  };
}
test('run ID is pinned to a NEW numeric owner trigger; first failed run is forbidden',()=>{
  assert.equal(newBackupInstanceFromRun(RUN),ID);
  for(const invalid of ['45090501363','45094020360','bad','../../escape','0',
    '45094020360-1','9999999999999999999',''])
    assert.throws(()=>newBackupInstanceFromRun(invalid),/invalid_trigger_run_id/);
});
test('derive 3 exact keys at UTC day boundary; never enumerate all chat backups',()=>{
  const keys=expectedKeysFromStartedAt(RUN,'2026-11-24T00:00:01.000Z');
  assert.deepEqual(keys.map(x=>x.split('/')[2]),['2026-11-23','2026-11-24','2026-11-25']);
  assert.ok(keys.every(x=>x.endsWith('/'+ID+'.sql')));
  assert.throws(()=>expectedKeysFromStartedAt(RUN,'not-a-date'),/start_date/);
});
test('completion verified only when Cloudflare Workflow succeeded and object metadata matches',async()=>{
  const f=fake();
  const receipt=await inspectNewBackupReceipt(env(),{fetcher:f.fetcher});
  assert.equal(receipt.workflowReportedSuccess,true);
  assert.equal(receipt.backupMetadataReceiptVerified,true);
  assert.equal(receipt.bytes,123456);
  assert.equal(receipt.backupRestoreTested,false);
  assert.equal(receipt.zeroDataLossProven,false);
  assert.equal(receipt.chatDataRead,false);
  assert.equal(f.calls.length,4);
  assert.ok(!JSON.stringify(receipt).includes(ID));
  assert.ok(!JSON.stringify(receipt).includes('.sql'));
});
test('running Workflow NEVER claims backup and never lists objects',async()=>{
  const f=fake('running');
  const r=await inspectNewBackupReceipt(env(),{fetcher:f.fetcher});
  assert.equal(f.calls.length,1);
  assert.equal(r.needsRecheck,true);
  assert.equal(r.backupMetadataReceiptVerified,false);
});
test('errored Workflow records any partial object but is not a completed backup',async()=>{
  const f=fake('errored');
  const r=await inspectNewBackupReceipt(env(),{fetcher:f.fetcher});
  assert.equal(r.workflowStatus,'errored');
  assert.equal(r.exactPrivateR2ObjectFound,true);
  assert.equal(r.metadataValidated,true);
  assert.equal(r.backupMetadataReceiptVerified,false);
  assert.equal(f.calls.length,4);
});
test('no object, wrong metadata or oversized object can never prove a backup',()=>{
  for(const candidate of [
    [],
    [{...goodObject(),size:0}],
    [{...goodObject(),size:70*1024*1024}],
    [{...goodObject(),custom_metadata:{...goodObject().custom_metadata,source:'not-chat'}}],
    [{...goodObject(),custom_metadata:{...goodObject().custom_metadata,workflowInstance:'different'}}],
    [{...goodObject(),http_metadata:{contentType:'text/html'}}]
  ]){
    const r=summarizeNewBackupReceipt({status:'complete',success:true,start:START},candidate,RUN);
    assert.equal(r.backupMetadataReceiptVerified,false);
  }
  assert.throws(()=>summarizeNewBackupReceipt({status:'complete',success:true,start:START},
    [goodObject(),goodObject()],RUN),/multiple_objects_ambiguous/);
});
test('Cloudflare R2 token 403 is not absence and must fail closed',async()=>{
  const f=fake('complete',[goodObject()],403);
  await assert.rejects(inspectNewBackupReceipt(env(),{fetcher:f.fetcher}),/r2_metadata_http_403/);
});
test('unapproved env cannot query Cloudflare; no API mutations anywhere',async()=>{
  for(const bad of [
    {GITHUB_REF:'refs/heads/feature'},
    {GITHUB_REPOSITORY:'other/repo'},
    {CLOUDFLARE_ACCOUNT_ID:'wrong'},
    {BOR_BACKUP_RECEIPT_AUDIT_APPROVED:'TRIGGER_BOR_PRIVATE_CHAT_BACKUP'},
    {CLOUDFLARE_R2_AUDIT_TOKEN:''}
  ]){
    let n=0;
    await assert.rejects(inspectNewBackupReceipt({...env(),...bad},{
      fetcher:async()=>{n++;throw Error('MUST_NOT_CALL');}
    }),/not_authorized/);
    assert.equal(n,0);
  }
});
