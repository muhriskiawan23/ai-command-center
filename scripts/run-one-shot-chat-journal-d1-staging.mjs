// SINGLE-USE authorized staging-only synthetic DO -> D1 recovery runner.
// Never operates on BOR AI production Workers/D1. This script is inert unless
// dispatched by the dedicated, exact-SHA-gated GitHub Actions workflow.
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';

export const ACCOUNT_PIN='1698b70193eb133044e9fb07e39b7740';
export const PROD_D1_PIN='d71231a9-9a04-471c-b904-d1bc843940aa';
export const REVIEWED_PR_SHA='b7e8b97f8fd68c4cf0e3aa8b84e2ff988146e657';
export const OWNER_APPROVAL='I_APPROVE_ONE_SYNTHETIC_DO_D1_WORKER_WORKFLOW_CLEANUP';
export const COST_APPROVAL='I_APPROVE_TEMP_CLOUDFLARE_STAGING_USAGE';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const RUN=/^[0-9]{8,18}$/;
const fail=code=>{throw Error(code);};

export function identity(runId){
  if(!RUN.test(runId||''))fail('invalid_run_id');
  return Object.freeze({
    db:'bor-ai-journal-recovery-'+runId,
    worker:'bor-ai-chat-recovery-d1-'+runId,
    workflow:'bor-ai-chat-recovery-d1-drill-'+runId,
    instance:'bor-recovery-'+runId
  });
}
export function safePreflight(env){
  const names=identity(env.GITHUB_RUN_ID);
  if(env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='push'||
    env.GITHUB_RUN_ATTEMPT!=='1'||
    env.BOR_OWNER_APPROVAL!==OWNER_APPROVAL||env.BOR_COST_APPROVAL!==COST_APPROVAL||
    env.BOR_REVIEWED_PR_SHA!==REVIEWED_PR_SHA||
    env.CLOUDFLARE_ACCOUNT_ID!==ACCOUNT_PIN||
    typeof env.CLOUDFLARE_API_TOKEN!=='string'||env.CLOUDFLARE_API_TOKEN.length<20||
    typeof env.BOR_PRIVATE_D1_EXPORT_TOKEN!=='string'||env.BOR_PRIVATE_D1_EXPORT_TOKEN.length<20||
    typeof env.BOR_PR_DIR!=='string'||!env.BOR_PR_DIR.includes('reviewed-recovery-pr')||
    typeof env.BOR_WRANGLER_BIN!=='string'||!env.BOR_WRANGLER_BIN.endsWith('/wrangler'))
    fail('staging_runner_preflight_denied');
  return names;
}
export function validateCreatedD1(result,dbName){
  if(!result||result.name!==dbName||!UUID.test(result.uuid||'')||
    result.uuid.toLowerCase()===PROD_D1_PIN)
    fail('unexpected_disposable_d1_identity');
  return result.uuid;
}

export async function runOnce(env,{request=fetch,cli=spawnSync,log=console.log}={}){
  const names=safePreflight(env);
  const account=ACCOUNT_PIN;
  const dir=resolve(env.BOR_PR_DIR);
  const cfBase='https://api.cloudflare.com/client/v4/accounts/'+account+'/';
  const headers=token=>({Authorization:'Bearer '+token,Accept:'application/json'});
  const workerToken=env.CLOUDFLARE_API_TOKEN,d1Token=env.BOR_PRIVATE_D1_EXPORT_TOKEN;
  const d1Base='d1/database',workerBase='workers/scripts/'+names.worker;
  const wfBase='workflows/'+names.workflow;
  const verifiedPath=(path)=>path==='d1/database'||path==='workers/scripts/'+names.worker||
    path==='workers/scripts/'+names.worker+'/subdomain'||
    path==='workflows/'+names.workflow||
    path==='workflows/'+names.workflow+'/instances'||
    path==='workflows/'+names.workflow+'/instances/'+names.instance||
    path==='d1/database/'+dbUuid;
  let dbUuid=null,dbCreateAttempted=false,workerAttempted=false,drillStarted=false,passed=false;
  const errors=[];
  async function cf(token,method,path,body,{notFound=false}={}){
    if(!verifiedPath(path))fail('staging_runner_api_path_denied');
    let response;
    try{
      response=await request(cfBase+path,{method,redirect:'error',
        headers:{...headers(token),...(body===undefined?{}:{'Content-Type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),
        signal:AbortSignal.timeout(25000)});
    }catch{fail('staging_runner_'+method+'_network_unavailable');}
    if(response.status===404&&notFound)return {missing:true};
    if(!response.ok)fail('staging_runner_'+method+'_http_'+response.status);
    let json;
    try{json=await response.json();}catch{fail('staging_runner_invalid_api_response');}
    if(json?.success!==true)fail('staging_runner_api_rejected');
    return {missing:false,result:json.result};
  }
  function wrangler(args,{input}={}){
    const result=cli(env.BOR_WRANGLER_BIN,args,{cwd:dir,env:{
      ...process.env,CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:workerToken,
      CLOUDFLARE_SEND_METRICS:'false',CI:'true'
    },encoding:'utf8',input,timeout:125000,stdio:'pipe'});
    if(result.error||result.status!==0)
      fail('staging_runner_wrangler_failed_'+args[0]+'_exit_'+String(result.status??'unknown'));
  }
  async function readExists(path,token){
    if(!verifiedPath(path))fail('staging_runner_api_path_denied');
    let response;
    try{
      response=await request(cfBase+path,{method:'GET',redirect:'error',
        headers:headers(token),signal:AbortSignal.timeout(25000)});
    }catch{fail('staging_runner_presence_check_unavailable');}
    if(response.status===404)return false;
    if(response.status===200)return true;
    fail('staging_runner_presence_check_http_'+response.status);
  }
  async function listExactRunD1(){
    // This fallback is only for an ambiguous create response. Never delete
    // arbitrary databases or anything with a non-exact run-specific name.
    let response;
    try{
      response=await request(cfBase+d1Base+'?per_page=100',{method:'GET',redirect:'error',
        headers:headers(d1Token),signal:AbortSignal.timeout(25000)});
    }catch{return [];}
    if(!response.ok)return [];
    let value;
    try{value=await response.json();}catch{return [];}
    if(value?.success!==true||!Array.isArray(value.result))return [];
    return value.result.filter(x=>x?.name===names.db&&UUID.test(x.uuid||'')&&
      x.uuid.toLowerCase()!==PROD_D1_PIN);
  }
  async function deleteCreatedDb(){
    let ids=dbUuid?[{name:names.db,uuid:dbUuid}]:[];
    if(dbCreateAttempted&&!ids.length)ids=await listExactRunD1();
    if(ids.length>1){errors.push('ambiguous_database_cleanup_manual_review');return;}
    for(const item of ids){
      try{
        validateCreatedD1(item,names.db);
        await cf(d1Token,'DELETE',d1Base+'/'+item.uuid);
        log('STAGING_D1_CLEANUP_DELETED',JSON.stringify({name:names.db,uuid:item.uuid}));
      }catch{errors.push('d1_cleanup_failed_'+item.uuid);}
    }
    if(dbCreateAttempted&&!ids.length)errors.push('d1_create_unconfirmed_no_cleanup_receipt');
  }
  async function deleteIfPresent(token,path,label){
    try{
      if(await readExists(path,token)){
        await cf(token,'DELETE',path);
        if(await readExists(path,token))fail('resource_still_present');
      }
      log('STAGING_CLEANUP_ABSENT',label);
      return true;
    }catch{errors.push(label+'_cleanup_failed');return false;}
  }
  let receipt=null;
  try{
    // Before any Cloudflare change, confirm the requested Worker & Workflow
    // do not already exist; never overwrite any existing Worker.
    if(await readExists(workerBase,workerToken)||await readExists(wfBase,workerToken))
      fail('staging_runner_resource_name_already_exists');
    // The source must be the previously reviewed exact SHA, never main.
    const sha=cli('git',['-C',dir,'rev-parse','HEAD'],{encoding:'utf8',timeout:10000});
    if(sha.status!==0||sha.stdout.trim()!==REVIEWED_PR_SHA)
      fail('staging_runner_checkout_sha_mismatch');
    const pro=JSON.parse(readFileSync(join(dir,'wrangler.jsonc'),'utf8'));
    if(pro.name!=='ai-command-center'||!pro.d1_databases?.some(x=>
       x.database_id===PROD_D1_PIN&&x.database_name==='bor-ai-chat'))
      fail('staging_runner_primary_identity_changed');

    dbCreateAttempted=true;
    const created=await cf(d1Token,'POST',d1Base,{name:names.db});
    dbUuid=validateCreatedD1(created.result,names.db);
    log('STAGING_D1_CREATED',JSON.stringify({name:names.db,uuid:dbUuid}));
    wrangler(['--version']);
    const generated=cli('node',['scripts/prepare-chat-journal-d1-recovery-staging.mjs',env.GITHUB_RUN_ID,dbUuid],
      {cwd:dir,env:process.env,encoding:'utf8',timeout:15000});
    if(generated.status!==0)fail('staging_runner_config_generation_failed');
    const cfg='wrangler.chat-journal-d1-recovery.generated.jsonc';
    const checked=JSON.parse(readFileSync(join(dir,cfg),'utf8'));
    if(checked.name!==names.worker||checked.workflows?.[0]?.name!==names.workflow||
      checked.d1_databases?.length!==1||
      checked.d1_databases[0]?.database_id!==dbUuid||
      checked.workers_dev!==false||checked.preview_urls!==false||
      !checked.main.endsWith('staging-d1-worker.js')||
      checked.vars?.CHAT_JOURNAL_ACTIVE!=='false')
      fail('staging_runner_generated_config_unsafe');
    wrangler(['deploy','--dry-run','--config',cfg]);
    workerAttempted=true;
    wrangler(['deploy','--config',cfg]);

    // Confirm the deployed Worker has NO workers.dev exposure. An absent or
    // ambiguous verification stops the run and initiates cleanup.
    const sub=await cf(workerToken,'GET',workerBase+'/subdomain');
    if(sub.result?.enabled!==false||sub.result?.previews_enabled!==false)
      fail('staging_runner_public_ingress_not_proven_disabled');
    log('STAGING_WORKER_PRIVATE_VERIFIED',names.worker);
    // New per-run secret, never print or reuse existing journal secret.
    const secret=randomBytes(40).toString('hex');
    wrangler(['secret','put','CHAT_JOURNAL_INTERNAL_SECRET','--config',cfg],{input:secret+'\n'});
    const inst=await cf(workerToken,'POST',wfBase+'/instances',{
      instance_id:names.instance,
      params:JSON.stringify({purpose:'BOR_SYNTHETIC_CLOSED_DO_D1_RECOVERY_V1'})
    });
    if(inst.result?.id!==names.instance)fail('staging_runner_workflow_instance_mismatch');
    drillStarted=true;
    log('STAGING_WORKFLOW_STARTED',names.instance);
    let state;
    for(let i=0;i<72;i++){
      await sleep(1600);
      const x=await cf(workerToken,'GET',wfBase+'/instances/'+names.instance);
      state=x.result;
      if(['complete','errored','terminated'].includes(state?.status))break;
    }
    if(state?.status!=='complete')fail('staging_runner_workflow_not_complete_'+String(state?.status||'unknown'));
    let output=state.output;
    if(typeof output==='string'){try{output=JSON.parse(output);}catch{}}
    if(!output||output.passed!==true||output.restoredMessages!==2||
      output.checkpoint!==3||output.batchAtomic!==true||
      output.rollbackBeforeCheckpoint!==true||output.retryIdempotent!==true||
      output.replayAgainNoOp!==true||output.foreignKeysClean!==true||
      output.productionD1Accessed!==false||output.customerDataAccessed!==false)
      fail('staging_runner_receipt_missing_or_invalid');
    receipt={passed:true,instance:names.instance,dbUuid,head:3,restoredMessages:2,
      rollbackVerified:true,replayVerified:true,foreignKeysClean:true};
    passed=true;
    log('STAGING_D1_RECOVERY_VERIFIED',JSON.stringify(receipt));
  }catch(e){
    log('STAGING_D1_RECOVERY_BLOCKED',String(e?.message||'unknown').slice(0,140));
  }finally{
    if(workerAttempted){
      // Deleting a Workflow also deletes its instances. It is never shared.
      const wfDeleted=await deleteIfPresent(workerToken,wfBase,'workflow');
      const workerDeleted=await deleteIfPresent(workerToken,workerBase,'worker');
      if(!wfDeleted)await deleteIfPresent(workerToken,wfBase,'workflow_retry');
      if(!workerDeleted)await deleteIfPresent(workerToken,workerBase,'worker_retry');
    }
    if(dbCreateAttempted)await deleteCreatedDb();
    if(errors.length)log('STAGING_CLEANUP_BLOCKERS',JSON.stringify(errors));
    log('STAGING_D1_FINAL',JSON.stringify({passed,drillStarted,cleanupComplete:errors.length===0,
      temporaryD1:dbUuid,worker:names.worker,workflow:names.workflow}));
  }
  if(errors.length)fail('staging_runner_cleanup_incomplete');
  if(!passed)fail('staging_runner_drill_failed_or_not_run');
  return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runOnce(process.env).catch(e=>{console.error('CLOSED_STAGING_DRILL_FAILED',e.message);process.exitCode=1;});
}
