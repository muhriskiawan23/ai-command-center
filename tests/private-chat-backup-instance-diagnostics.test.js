import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT,WORKFLOW,INSTANCE,classifyProviderError,
  safeWorkflowDiagnostic,diagnoseErroredBackupInstance
} from '../scripts/diagnose-private-chat-backup-instance-readonly.mjs';

const env=()=>({
 GITHUB_REPOSITORY:'muhriskiawan23/ai-command-center',
 GITHUB_REF:'refs/heads/main',
 CLOUDFLARE_ACCOUNT_ID:ACCOUNT,
 BOR_BACKUP_RECEIPT_AUDIT_APPROVED:'AUDIT_ONLY_NO_EXPORT',
 CLOUDFLARE_BACKUP_DEPLOY_TOKEN:'SYNTHETIC_TEST_ONLY_FAKE_TOKEN_123'
});
test('only known BOR error codes are shown, never raw signed URL or private data',()=>{
 const secret='https://private.cloudflarestorage.com/SQL?sig=SENSITIVE';
 assert.equal(classifyProviderError({message:'Error: private_backup_export_api_unavailable '+
   secret}),'private_backup_export_api_unavailable');
 assert.equal(classifyProviderError({name:'Error',message:'unrecognized '+secret}),
   'provider_error_redacted');
 assert.equal(classifyProviderError({name:'TypeError',message:'private chat SQL leaked '+secret}),
   'provider_type_error');
});
test('errored instance only outputs allowlisted step names and error categories',()=>{
 const privateText='SECRET: SELECT email FROM users; https://r2.example/path?sig=sensitive';
 const result=safeWorkflowDiagnostic({
  status:'errored',error:{name:'Error',message:'Error: private_backup_export_secret_missing '+privateText},
  step_count:3,output:privateText,params:privateText,
  steps:[
   {name:'start pinned D1 private export',status:'errored',output:privateText,
    attempts:[{error:{message:'Error: private_backup_export_api_unavailable '+privateText}}]},
   {name:'PRIVATE USER CHAT '+privateText,status:'complete',output:privateText,
    attempts:[]}
  ]
 });
 assert.equal(result.workflowStatus,'errored');
 assert.equal(result.instanceFailureCategory,'private_backup_export_secret_missing');
 assert.equal(result.backupCompleted,false);
 assert.equal(result.privateR2ReceiptVerified,false);
 assert.equal(result.steps.length,1);
 assert.equal(result.steps[0].step,'start_private_export');
 assert.deepEqual(result.steps[0].failureCategories,['private_backup_export_api_unavailable']);
 const out=JSON.stringify(result);
 assert.ok(!out.includes(privateText));
 assert.ok(!out.includes('SELECT'));
 assert.ok(!out.includes('sig='));
 assert.equal(result.customerSQLRead,false);
});
test('successful GET to exact Workflow returns only sanitized classification',async()=>{
 let count=0;
 const result=await diagnoseErroredBackupInstance(env(),{fetcher:async(url,opts)=>{
  count++;
  const u=new URL(url);
  assert.equal(u.hostname,'api.cloudflare.com');
  assert.equal(u.pathname,'/client/v4/accounts/'+ACCOUNT+'/workflows/'+WORKFLOW+'/instances/'+INSTANCE);
  assert.equal(u.searchParams.get('simple'),'false');
  assert.equal(u.searchParams.get('order'),'asc');
  assert.equal(opts.method,'GET');
  assert.equal(opts.redirect,'error');
  assert.ok(!opts.body);
  return Response.json({success:true,result:{status:'errored',error:{name:'Error',
   message:'private_backup_signed_url_not_approved'},steps:[]}});
 }});
 assert.equal(count,1);
 assert.equal(result.instanceFailureCategory,'private_backup_signed_url_not_approved');
});
test('wrong scope/secret prevents even GET, forbidden responses have categorical errors',async()=>{
 for(const bad of [
  {GITHUB_REF:'refs/heads/feature'},
  {CLOUDFLARE_ACCOUNT_ID:'wrong'},
  {BOR_BACKUP_RECEIPT_AUDIT_APPROVED:'not_authorized'},
  {CLOUDFLARE_BACKUP_DEPLOY_TOKEN:''}
 ]) {
  let calls=0;
  await assert.rejects(diagnoseErroredBackupInstance({...env(),...bad},{fetcher:async()=>{
   calls++;throw Error('must not call');
  }}),/not_authorized/);
  assert.equal(calls,0);
 }
 await assert.rejects(diagnoseErroredBackupInstance(env(),{fetcher:async()=>Response.json(
  {success:false},{status:403})}),/http_403/);
});
