import test from 'node:test';
import assert from 'node:assert/strict';
import {CF_ACCOUNT,BACKUP_WORKFLOW_NAME} from '../scripts/audit-private-chat-backup-new-run-readonly.mjs';
import {SECOND_BACKUP_RUN_ID,validateSecondBackupDiagnosticEnv,diagnoseSecondBackup}
  from '../scripts/diagnose-second-private-backup-readonly.mjs';

const instance='bor-ai-private-backup-'+SECOND_BACKUP_RUN_ID+'-1';
const secret='https://signed.cloudflarestorage.com/something?secret=NEVER_LOG';
const env=()=>({
 GITHUB_REPOSITORY:'muhriskiawan23/ai-command-center',
 GITHUB_REF:'refs/heads/main',CLOUDFLARE_ACCOUNT_ID:CF_ACCOUNT,
 BOR_BACKUP_RECEIPT_AUDIT_APPROVED:'AUDIT_ONLY_NO_EXPORT',
 BOR_BACKUP_TRIGGER_RUN_ID:SECOND_BACKUP_RUN_ID,
 CLOUDFLARE_BACKUP_DEPLOY_TOKEN:'SYNTHETIC_ONLY_NONREAL_KEY_LONG'
});
test('only exact already-triggered second run can be diagnosed; fail before any calls',async()=>{
 for(const change of [
   {BOR_BACKUP_TRIGGER_RUN_ID:'45090501363'},
   {BOR_BACKUP_TRIGGER_RUN_ID:'45099999999'},
   {BOR_BACKUP_TRIGGER_RUN_ID:'bad'},
   {GITHUB_REPOSITORY:'other/repo'},
   {GITHUB_REF:'refs/heads/unreviewed'},
   {CLOUDFLARE_ACCOUNT_ID:'wrong'},
   {BOR_BACKUP_RECEIPT_AUDIT_APPROVED:'TRIGGER_BOR_PRIVATE_CHAT_BACKUP'},
   {CLOUDFLARE_BACKUP_DEPLOY_TOKEN:''}
 ]){
   let calls=0;
   await assert.rejects(diagnoseSecondBackup({...env(),...change},{fetcher:async()=>{
     calls++;throw Error('MUST NOT CALL');
   }}),/not_authorized/);
   assert.equal(calls,0);
 }
 assert.equal(validateSecondBackupDiagnosticEnv(env()),instance);
});
test('one GET to exact Cloudflare errored instance yields categorical error only',async()=>{
 let count=0;
 const result=await diagnoseSecondBackup(env(),{fetcher:async(url,opt)=>{
  count++;
  const u=new URL(url);
  assert.equal(u.hostname,'api.cloudflare.com');
  assert.equal(u.pathname,'/client/v4/accounts/'+CF_ACCOUNT+'/workflows/'+
    BACKUP_WORKFLOW_NAME+'/instances/'+instance);
  assert.equal(u.searchParams.get('simple'),'false');
  assert.equal(u.searchParams.get('order'),'asc');
  assert.equal(opt.method,'GET');
  assert.equal(opt.redirect,'error');
  assert.equal(opt.body,undefined);
  return Response.json({success:true,result:{
    status:'errored',step_count:1,
    output:secret,params:secret,bookmark:secret,
    error:{name:'Error',message:'Error: private_backup_export_api_unavailable '+secret},
    steps:[{name:'PRIVATE CUSTOMER TEXT '+secret,status:'errored',
      attempts:[{error:{name:'Error',message:secret}}]}]
  }});
 }});
 assert.equal(count,1);
 assert.equal(result.workflowStatus,'errored');
 assert.equal(result.instanceFailureCategory,'private_backup_export_api_unavailable');
 assert.equal(result.backupCompleted,false);
 assert.equal(result.sqlDownloaded,false);
 assert.equal(result.productionBackupRetried,false);
 assert.equal(result.originalRawErrorsExposed,false);
 assert.equal(result.steps.length,0);
 assert.equal(result.cloudflareRequests,'one_GET_only');
 const output=JSON.stringify(result);
 assert.ok(!output.includes(secret));
 assert.ok(!output.includes('PRIVATE CUSTOMER'));
 assert.ok(!output.includes('bookmark'));
});
test('READ-only audit rejects provider 403 and malformed result, no writes',async()=>{
 await assert.rejects(diagnoseSecondBackup(env(),{
  fetcher:async()=>Response.json({success:false},{status:403})
 }),/second_backup_diagnose_http_403/);
 await assert.rejects(diagnoseSecondBackup(env(),{
  fetcher:async()=>Response.json({success:true,result:null})
 }),/second_backup_diagnose_api_rejected/);
});
