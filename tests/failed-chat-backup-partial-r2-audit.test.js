import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKUP_ACCOUNT,BACKUP_BUCKET,BACKUP_INSTANCE,BACKUP_KEY}
  from '../scripts/audit-private-chat-backup-instance-readonly.mjs';
import {assessFailedBackupObjectList,auditFailedBackupPartialR2}
  from '../scripts/audit-failed-chat-backup-partial-r2.mjs';

const fakeEnv=()=>({
  GITHUB_REPOSITORY:'muhriskiawan23/ai-command-center',
  GITHUB_REF:'refs/heads/main',CLOUDFLARE_ACCOUNT_ID:BACKUP_ACCOUNT,
  BOR_BACKUP_RECEIPT_AUDIT_APPROVED:'AUDIT_ONLY_NO_EXPORT',
  CLOUDFLARE_R2_AUDIT_TOKEN:'SYNTHETIC_ONLY_READ_METADATA_TOKEN'
});
const object=()=>({key:BACKUP_KEY,size:12345,
  custom_metadata:{source:'bor-ai-chat',workflowInstance:BACKUP_INSTANCE,format:'d1-sql'},
  http_metadata:{contentType:'application/sql'}});
const response=(results,other={})=>({success:true,result:results,result_info:{is_truncated:false,...other}});
test('old errored Workflow never implies empty R2; exact object is metadata-only evidence',()=>{
  const found=assessFailedBackupObjectList(response([object()]));
  assert.equal(found.exactExpectedObjectPresent,true);
  assert.equal(found.expectedObjectMetadataValid,true);
  assert.equal(found.bytes,12345);
  assert.equal(found.backupCompletionUnproven,true);
  assert.equal(found.sqlRead,false);
  assert.ok(!JSON.stringify(found).includes(BACKUP_KEY));
  const missing=assessFailedBackupObjectList(response([]));
  assert.equal(missing.exactExpectedObjectPresent,false);
  assert.equal(missing.backupCompletionUnproven,true);
});
test('untrusted or ambiguous list is never a verified backup',()=>{
  for(const invalid of [
    {success:false,result:[]},{success:true,result:{}},
    response([object()],{is_truncated:true}),
    response([object(),object()])
  ])assert.throws(()=>assessFailedBackupObjectList(invalid),/private_backup_partial_/);
  const bad=assessFailedBackupObjectList(response([
    {...object(),custom_metadata:{...object().custom_metadata,source:'different'}}
  ]));
  assert.equal(bad.exactExpectedObjectPresent,true);
  assert.equal(bad.expectedObjectMetadataValid,false);
});
test('only GET exact private R2 prefix, never D1/Workflow trigger or SQL download',async()=>{
  const requests=[];
  const result=await auditFailedBackupPartialR2(fakeEnv(),{fetcher:async(url,options)=>{
    requests.push({url,options});
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.equal(options.body,undefined);
    const parsed=new URL(url);
    assert.equal(parsed.hostname,'api.cloudflare.com');
    assert.equal(parsed.pathname,'/client/v4/accounts/'+BACKUP_ACCOUNT+'/r2/buckets/'+BACKUP_BUCKET+'/objects');
    assert.equal(parsed.searchParams.get('prefix'),BACKUP_KEY);
    assert.equal(parsed.searchParams.get('per_page'),'10');
    assert.ok(!url.includes('/d1/database'));
    assert.ok(!url.includes('/workflows'));
    return Response.json(response([object()]));
  }});
  assert.equal(result.exactExpectedObjectPresent,true);
  assert.equal(requests.length,1);
});
test('R2 object-level permission denied fails closed and never claims object is missing',async()=>{
  await assert.rejects(auditFailedBackupPartialR2(fakeEnv(),{
    fetcher:async()=>Response.json({success:false},{status:403})
  }),/metadata_http_403/);
});
test('incorrect account/branch/approval/token prevents any Cloudflare call',async()=>{
  for(const mutation of [
    {GITHUB_REF:'refs/heads/not-main'},
    {CLOUDFLARE_ACCOUNT_ID:'wrong'},
    {BOR_BACKUP_RECEIPT_AUDIT_APPROVED:'wrong'},
    {CLOUDFLARE_R2_AUDIT_TOKEN:''}
  ]){
    let count=0;
    await assert.rejects(auditFailedBackupPartialR2({...fakeEnv(),...mutation},{
      fetcher:async()=>{count++;throw Error('should never call');}
    }),/not_authorized/);
    assert.equal(count,0);
  }
});
