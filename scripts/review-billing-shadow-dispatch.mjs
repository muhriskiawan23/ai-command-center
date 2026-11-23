#!/usr/bin/env node
// Offline, fail-closed production-dispatch gate. NO Cloudflare calls, writes or deploy.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const SHADOW_CONFIRMATION='CONFIRM_BOR_AI_SHADOW_READONLY_RELEASE';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function boolean(value,label){
  if(value==='true'||value===true)return true;
  if(value==='false'||value===false)return false;
  throw Error('billing_shadow_invalid_dispatch_boolean_'+label);
}
function normalizedId(value){
  if(typeof value!=='string'||!UUID.test(value))return null;
  const id=value.toLowerCase();
  return /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id)?null:id;
}
export function reviewBillingShadowDispatch({
  enabled='false',confirmation='',shadowD1Id='',applyMigrations='false',
  runTavilySmoke='false',preserveReader='false',allowReaderShutdown='false',
  enableImagePilot='false',imagesEnabled='false',lunaPrimary='false',
  production,sandbox
}={}){
  const enabledFlag=boolean(enabled,'enabled');
  if(!enabledFlag)return Object.freeze({billingShadowAuthorized:false});
  const incompatible=[
    ['apply_migrations',applyMigrations],['tavily_smoke',runTavilySmoke],
    ['reader_preservation',preserveReader],['reader_shutdown',allowReaderShutdown],
    ['paid_image_pilot',enableImagePilot],['images_enabled',imagesEnabled],
    ['paid_luna_primary',lunaPrimary]
  ];
  if(incompatible.some(([name,value])=>boolean(value,name)))
    throw Error('billing_shadow_must_be_released_alone');
  if(confirmation!==SHADOW_CONFIRMATION)
    throw Error('billing_shadow_explicit_confirmation_required');
  const id=normalizedId(shadowD1Id);
  if(!id)throw Error('billing_shadow_distinct_d1_id_required');
  const prodD1=production?.d1_databases;
  const sandboxD1=sandbox?.d1_databases;
  if(production?.name!=='ai-command-center'||prodD1?.length!==1||
     prodD1[0]?.binding!=='DB'||prodD1[0]?.database_name!=='bor-ai-chat'||
     sandbox?.name!=='bor-ai-duitku-sandbox'||sandboxD1?.length!==1||
     sandboxD1[0]?.binding!=='SANDBOX_DB'||sandboxD1[0]?.database_name!=='bor-ai-duitku-sandbox')
    throw Error('billing_shadow_checked_in_identity_mismatch');
  const chatId=normalizedId(prodD1[0].database_id);
  const proofId=normalizedId(sandboxD1[0].database_id);
  if(!chatId||!proofId||chatId===proofId||id===chatId||id===proofId)
    throw Error('billing_shadow_distinct_d1_id_required');
  if(production.vars?.BOR_BILLING_SHADOW_ENABLED==='true'||
     prodD1.some(x=>x.binding==='BILLING_SHADOW_DB'))
    throw Error('billing_shadow_must_remain_off_in_checked_in_config');
  return Object.freeze({billingShadowAuthorized:true,noncommercial:true});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const read=path=>JSON.parse(readFileSync(path,'utf8'));
    const result=reviewBillingShadowDispatch({
      enabled:process.env.BOR_BILLING_SHADOW_ENABLED,
      confirmation:process.env.BOR_BILLING_SHADOW_CONFIRMATION,
      shadowD1Id:process.env.BOR_BILLING_SHADOW_D1_ID,
      applyMigrations:process.env.BOR_APPLY_DB_MIGRATIONS,
      runTavilySmoke:process.env.BOR_RUN_TAVILY_SMOKE,
      preserveReader:process.env.BOR_PRESERVE_READER,
      allowReaderShutdown:process.env.BOR_ALLOW_READER_SHUTDOWN,
      enableImagePilot:process.env.IMAGE_PILOT_RELEASE_APPROVED,
      imagesEnabled:process.env.BOR_IMAGES_ENABLED,
      lunaPrimary:process.env.BOR_TEXT_LUNA_PRIMARY,
      production:read('wrangler.jsonc'),
      sandbox:read('wrangler.duitku-sandbox.jsonc')
    });
    console.log(result.billingShadowAuthorized
      ? 'Shadow dispatch consent and isolated release invariants verified. This does NOT authorize customer money, credits or a commercial GO.'
      : 'Billing shadow remains disabled for this dispatch.');
  }catch(e){
    // Never echo identifiers, user-supplied confirmation, token or file content.
    const allowed=new Set([
      'billing_shadow_must_be_released_alone',
      'billing_shadow_explicit_confirmation_required',
      'billing_shadow_distinct_d1_id_required',
      'billing_shadow_checked_in_identity_mismatch',
      'billing_shadow_must_remain_off_in_checked_in_config'
    ]);
    console.error('Billing shadow dispatch refused:',allowed.has(e.message)?e.message:'invalid_release_dispatch');
    process.exitCode=1;
  }
}
