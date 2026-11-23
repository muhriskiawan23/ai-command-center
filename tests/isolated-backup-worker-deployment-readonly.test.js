import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectIsolatedBackupDeployment,ISOLATED_BACKUP_WORKER}
  from '../scripts/audit-isolated-backup-worker-deployment-readonly.mjs';

const env={
  CLOUDFLARE_ACCOUNT_ID:'00000000000000000000000000000000',
  CLOUDFLARE_BACKUP_DEPLOY_TOKEN:'SYNTHETIC-TEST-TOKEN-DO-NOT-USE'
};
const versionId='8afa59c8-8fed-4875-9c8b-d67e05914dc7';
const deploymentId='182bd5e5-6e1a-4fe4-a799-aa6d9a6ab26e';
const fakeJson=()=>({success:true,result:{deployments:[{
  id:deploymentId,created_on:'2026-11-23T02:00:00Z',
  versions:[{version_id:versionId,percentage:100}]
}]}});

test('read-only audit uses exactly one GET to fixed isolated backup Worker metadata API',async()=>{
  let calls=0;
  const fetcher=async(url,options)=>{
    calls++;
    assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/'+
      env.CLOUDFLARE_ACCOUNT_ID+'/workers/scripts/'+
      ISOLATED_BACKUP_WORKER+'/deployments?page=1&per_page=1');
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer '+env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN);
    return Response.json(fakeJson());
  };
  const receipt=await inspectIsolatedBackupDeployment({env,fetcher});
  assert.equal(calls,1);
  assert.deepEqual(receipt.versions,[{versionId,percentage:100}]);
  assert.equal(receipt.activeDeploymentId,deploymentId);
  assert.equal(receipt.worker,'bor-ai-chat-backup-isolated');
  for(const key of ['readOnly','exportTriggered','mutationsPerformed','sourceCodeVerified',
    'backupCompleted','productionDataRead']) assert.equal(typeof receipt[key],'boolean');
  assert.equal(receipt.sourceCodeVerified,false);
  assert.equal(receipt.backupCompleted,false);
  assert.equal(receipt.exportTriggered,false);
  assert.equal(receipt.mutationsPerformed,false);
  assert.equal(receipt.productionDataRead,false);
  assert.equal(JSON.stringify(receipt).includes(env.CLOUDFLARE_BACKUP_DEPLOY_TOKEN),false);
});

test('missing credential fails closed before any network calls',async()=>{
  let calls=0;
  for(const bad of [{...env,CLOUDFLARE_BACKUP_DEPLOY_TOKEN:''},
    {...env,CLOUDFLARE_ACCOUNT_ID:'not-a-cloudflare-account'}]){
    await assert.rejects(inspectIsolatedBackupDeployment({
      env:bad,fetcher:async()=>{calls++;return Response.json(fakeJson());}
    }),/isolated_backup_audit_credentials_missing/);
  }
  assert.equal(calls,0);
});

test('metadata audit rejects malformed, missing, partial and provider-error replies without leaking bodies',async()=>{
  const secret='PRIVATE-SQL-DO-NOT-LOG';
  const invalid=[
    {status:403,body:{errors:[{message:secret}]}},
    {status:200,body:{success:false,result:{deployments:[]}}},
    {status:200,body:{success:true,result:{deployments:[]}}},
    {status:200,body:{success:true,result:{deployments:[{
      ...fakeJson().result.deployments[0],
      versions:[{version_id:versionId,percentage:40}]
    }]}}},
    {status:200,body:{success:true,result:{deployments:[{
      ...fakeJson().result.deployments[0],id:'malformed'
    }]}}},
    {status:200,body:{success:true,result:{deployments:[
      ...fakeJson().result.deployments,
      ...fakeJson().result.deployments
    ]}}}
  ];
  for(const sample of invalid){
    let err;
    try{await inspectIsolatedBackupDeployment({env,fetcher:async()=>
      Response.json(sample.body,{status:sample.status})});}catch(error){err=error;}
    assert.ok(err);
    assert.match(err.message,/^isolated_backup_audit_/);
    assert.equal(err.message.includes(secret),false);
  }
});

test('manual metadata workflow and backup release both block any unapproved third export',()=>{
  const audit=readFileSync('.github/workflows/bor-ai-isolated-backup-worker-version-audit.yml','utf8');
  const release=readFileSync('.github/workflows/bor-ai-private-chat-backup-release.yml','utf8');
  const gate=release.slice(release.indexOf('- name: Reject unreviewed branch'),
    release.indexOf('- uses: actions/checkout'));
  assert.match(gate,/\$PHASE" == "trigger"/);
  assert.match(gate,/THIRD PRODUCTION D1 EXPORT LOCKED/);
  assert.match(gate,/exit 1/);
  assert.ok(release.indexOf('THIRD PRODUCTION D1 EXPORT LOCKED')<
            release.indexOf('secrets.CLOUDFLARE_BACKUP_DEPLOY_TOKEN'));
  assert.match(audit,/workflow_dispatch:/);
  assert.match(audit,/environment: production/);
  assert.match(audit,/AUDIT_ISOLATED_BACKUP_DEPLOYMENT_ONLY/);
  assert.match(audit,/refs\/heads\/main/);
  assert.match(audit,/reviewed_main_sha/);
  assert.match(audit,/method:'GET'|GET-only inspect deployed isolated Worker version metadata/);
  assert.match(audit,/scripts\/audit-isolated-backup-worker-deployment-readonly\.mjs/);
  assert.doesNotMatch(audit,/^\s+(?:push|pull_request|schedule):/m);
  assert.doesNotMatch(audit,/workflows trigger|d1 export|d1 execute|r2 object put|secret put|wrangler@.* deploy/);
});
