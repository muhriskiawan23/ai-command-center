import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyPrivateBackupBucket} from '../scripts/verify-private-backup-r2-preflight.mjs';

const account='1698b70193eb133044e9fb07e39b7740';
const name='bor-ai-chat-private-backups';
const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/r2/buckets/'+name;
function fixture({publicEnabled=false,domains=[],retentionDays=30,
  retentionEnabled=true,bucket=name,omitRule=false,missing=false}={}){
  const paths=[];
  const payload=(result,status=200)=>Response.json({success:status===200,result},{status});
  const fetcher=async(url,opts)=>{
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Authorization,'Bearer fake-readonly-token');
    paths.push(url);
    if(missing)return payload(null,404);
    switch(url){
      case base:return payload({name:bucket});
      case base+'/domains/managed':return payload({enabled:publicEnabled});
      case base+'/domains/custom':return payload({domains});
      case base+'/lifecycle':return payload({rules:omitRule?[]:[{
        id:'bor-chat-private-backup-retention',enabled:retentionEnabled,
        conditions:{prefix:'private/bor-ai-chat/'},
        deleteObjectsTransition:{condition:{type:'Age',maxAge:retentionDays*86400}}
      }]});
      default:throw Error('unexpected resource path');
    }
  };
  return {env:{CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_R2_AUDIT_TOKEN:'fake-readonly-token'},
    fetcher,paths};
}
test('private R2 backup audit succeeds only with matching account, no domains and 30 day retention',async()=>{
  const h=fixture();
  const result=await verifyPrivateBackupBucket(h);
  assert.deepEqual(result,{readOnly:true,privateBucketVerified:true,publicDomains:0,
    retentionDays:30,bucket:name,customerDataRead:false,objectsListed:false,
    createdResources:0,changedResources:0});
  assert.equal(h.paths.length,4);
  assert.equal(h.paths.every(url=>url.startsWith(base)),true);
});
test('absent, publicly exposed, wrong identity, missing or unreviewed lifecycle fail closed',async()=>{
  for(const options of [
    {missing:true},{publicEnabled:true},
    {domains:[{domain:'leak.example.com'}]},
    {retentionDays:60},{retentionDays:1},
    {retentionEnabled:false},{omitRule:true},
    {bucket:'bor-ai-images'}
  ]){
    const h=fixture(options);
    await assert.rejects(verifyPrivateBackupBucket(h),/private_backup_/);
    assert.equal(h.paths.every(url=>url.startsWith(base)),true);
  }
});
test('read-only audit rejects missing or invalid credentials before any Cloudflare call',async()=>{
  const h=fixture();
  for(const env of [{},{CLOUDFLARE_ACCOUNT_ID:'invalid',CLOUDFLARE_R2_AUDIT_TOKEN:'fake'},
    {CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_R2_AUDIT_TOKEN:''}]){
    await assert.rejects(verifyPrivateBackupBucket({...h,env}),/credentials_missing/);
  }
  assert.equal(h.paths.length,0);
});
test('manual backup bucket workflow never writes, exports D1 or reads customer data',()=>{
  const yaml=readFileSync('.github/workflows/bor-ai-private-backup-r2-audit.yml','utf8');
  assert.match(yaml,/workflow_dispatch:/);
  assert.match(yaml,/environment: production/);
  assert.match(yaml,/node scripts\/verify-private-backup-r2-preflight\.mjs/);
  assert.match(yaml,/secrets\.CLOUDFLARE_R2_AUDIT_TOKEN/);
  assert.doesNotMatch(yaml,/d1 migrations apply|d1 export|d1 execute|d1 time-travel restore/);
  assert.doesNotMatch(yaml,/r2 (?:bucket create|object put|bucket delete)|wrangler(?:@\S+)? deploy/);
  assert.doesNotMatch(yaml,/OPENAI_API_KEY|BOR_D1_EXPORT_TOKEN|CLOUDFLARE_D1_MIGRATION_TOKEN/);
  assert.doesNotMatch(yaml,/\b(push|pull_request|schedule):/);
});
