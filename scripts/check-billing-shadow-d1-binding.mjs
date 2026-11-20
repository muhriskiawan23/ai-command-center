#!/usr/bin/env node
// OFFLINE metadata preflight only. It never calls Cloudflare or runs migrations.
// Check a proposed *local* Wrangler candidate before any manually approved
// dedicated D1 provisioning/activation. Do not commit customer config or IDs.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZERO='00000000-0000-0000-0000-000000000000';
const EXPECTED_SHADOW='bor-ai-billing-shadow';
const expected={chat:'bor-ai-chat',stage:'bor-ai-billing-staging',proof:'bor-ai-duitku-sandbox'};

function byBinding(config,binding){
  return (config?.d1_databases||[]).filter(x=>x?.binding===binding);
}
function normalId(id){
  return typeof id==='string'&&UUID.test(id)&&id.toLowerCase()!==ZERO ? id.toLowerCase() : null;
}
export function auditBillingShadowBinding({production,stagingTemplate,proof,candidate,liveStagingD1Id}={}){
  const failures=[];
  const fail=code=>{if(!failures.includes(code))failures.push(code)};
  const prodChat=byBinding(production,'DB');
  const stage=byBinding(stagingTemplate,'BILLING_DB');
  const oldProof=byBinding(proof,'SANDBOX_DB');
  const targetChat=byBinding(candidate,'DB');
  const targetShadow=byBinding(candidate,'BILLING_SHADOW_DB');

  if(production?.name!=='ai-command-center'||production?.main!=='src/index.js'||
     production?.d1_databases?.length!==1||prodChat.length!==1||
     prodChat[0]?.database_name!==expected.chat||!normalId(prodChat[0]?.database_id))
    fail('production_chat_baseline_mismatch');
  if(production?.vars?.BOR_BILLING_SHADOW_ENABLED!==undefined||
     production?.vars?.BOR_BILLING_SHADOW_PEPPER!==undefined||
     byBinding(production,'BILLING_SHADOW_DB').length!==0)
    fail('production_shadow_must_remain_off');
  if(stagingTemplate?.name!==expected.stage||stage.length!==1||
     stage[0]?.database_name!==expected.stage||stage[0]?.database_id!==ZERO)
    fail('staging_template_mismatch');
  if(proof?.name!==expected.proof||oldProof.length!==1||
     oldProof[0]?.database_name!==expected.proof||!normalId(oldProof[0]?.database_id))
    fail('proof_baseline_mismatch');

  const stageId=normalId(liveStagingD1Id);
  if(!stageId)fail('live_staging_d1_id_required_for_comparison');
  const prodId=normalId(prodChat[0]?.database_id);
  const proofId=normalId(oldProof[0]?.database_id);
  if(stageId&&(stageId===prodId||stageId===proofId))
    fail('staging_d1_collides_with_known_binding');

  if(candidate?.name!==production?.name||candidate?.main!==production?.main||
     !Array.isArray(candidate?.d1_databases)||candidate.d1_databases.length!==2||
     targetChat.length!==1||targetShadow.length!==1)
    fail('candidate_worker_binding_layout_invalid');
  if(targetChat.length===1&&(targetChat[0].database_name!==expected.chat||
     normalId(targetChat[0].database_id)!==prodId||
     targetChat[0].migrations_dir!=='migrations'))
    fail('candidate_chat_binding_changed');
  if(targetShadow.length===1){
    const shadow=targetShadow[0];
    const shadowId=normalId(shadow.database_id);
    if(shadow.database_name!==EXPECTED_SHADOW||!shadowId||
       shadow.migrations_dir!=='staging/billing-shadow')
      fail('shadow_binding_invalid_or_migration_dir_unsafe');
    if(shadowId&&(shadowId===prodId||shadowId===stageId||shadowId===proofId))
      fail('shadow_database_id_reused');
  }
  // Staging and proof may never be attached to the customer Worker.
  if((candidate?.d1_databases||[]).some(x=>
    x?.database_name===expected.stage||x?.database_name===expected.proof||
    x?.binding==='BILLING_DB'||x?.binding==='SANDBOX_DB'))
    fail('synthetic_database_attached_to_customer_worker');

  // The candidate must be an exact copy of the current production config
  // except for the dedicated shadow binding and two explicitly approved OFF
  // metadata vars. This rejects covert changes to AI, auth limits, routes,
  // other D1 entries, env settings, secrets or unrelated Worker bindings.
  if(candidate && production){
    const normalized=structuredClone(candidate);
    if(Array.isArray(normalized.d1_databases))
      normalized.d1_databases=normalized.d1_databases.filter(x=>x?.binding!=='BILLING_SHADOW_DB');
    if(normalized.vars&&typeof normalized.vars==='object'){
      delete normalized.vars.BOR_BILLING_SHADOW_D1_NAME;
      delete normalized.vars.BOR_BILLING_SHADOW_ENABLED;
    }
    if(!isDeepStrictEqual(normalized,production))
      fail('candidate_unrelated_production_config_changed');
  }

  // Preflight is a *disabled preparation state*, never an activation permit.
  if(!['false',undefined].includes(candidate?.vars?.BOR_BILLING_SHADOW_ENABLED))
    fail('shadow_feature_must_remain_off');
  if(candidate?.vars?.BOR_BILLING_SHADOW_D1_NAME!==EXPECTED_SHADOW)
    fail('shadow_db_name_attestation_config_missing');
  if(candidate?.vars?.BOR_BILLING_SHADOW_PEPPER!==undefined||
     candidate?.vars?.DUITKU_LIVE_API_KEY!==undefined)
    fail('secrets_must_not_be_plaintext_vars');

  return {ok:failures.length===0,failures};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const path=process.argv[2];
    if(!path)throw new Error('candidate_file_required');
    const read=p=>JSON.parse(readFileSync(p,'utf8'));
    const report=auditBillingShadowBinding({
      production:read('wrangler.jsonc'),
      stagingTemplate:read('wrangler.billing-staging.jsonc'),
      proof:read('wrangler.duitku-sandbox.jsonc'),
      candidate:read(path),
      liveStagingD1Id:process.env.BOR_BILLING_STAGING_D1_ID
    });
    if(!report.ok){
      for(const code of report.failures)console.error('BLOCKED:',code);
      process.exitCode=1;
    }else{
      console.log('Offline binding metadata preflight passed (NO DEPLOY, NO DB CHECK).');
      console.log('Cloudflare D1 ownership, DB attestation, secrets, and live controls remain UNVERIFIED.');
    }
  }catch(e){
    console.error('BLOCKED:',e.message==='candidate_file_required'?'candidate_file_required':'candidate_file_missing_or_invalid');
    process.exitCode=1;
  }
}
