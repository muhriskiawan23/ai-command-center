#!/usr/bin/env node
// BOR AI Cloudflare D1 identity gate: GET metadata ONLY (no D1 SQL or writes).
// This is a manual, credential-gated readiness probe, NOT activation.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT=/^[a-f0-9]{32}$/i;
function id(value){return typeof value==='string'&&UUID.test(value)&&!/^0+$/.test(value.replaceAll('-',''))?value.toLowerCase():null}
export function expectedD1Identities({production,sandbox,stagingId,shadowId}={}){
  const prod=production?.d1_databases;
  const proof=sandbox?.d1_databases;
  if(production?.name!=='ai-command-center'||!Array.isArray(prod)||prod.length!==1||
     prod[0]?.binding!=='DB'||prod[0]?.database_name!=='bor-ai-chat'||
     sandbox?.name!=='bor-ai-duitku-sandbox'||!Array.isArray(proof)||proof.length!==1||
     proof[0]?.binding!=='SANDBOX_DB'||proof[0]?.database_name!=='bor-ai-duitku-sandbox')
     throw new Error('unexpected_checked_in_d1_layout');
  const entries=[
    {label:'chat',name:'bor-ai-chat',uuid:id(prod[0].database_id)},
    {label:'duitku_proof',name:'bor-ai-duitku-sandbox',uuid:id(proof[0].database_id)},
    {label:'billing_staging',name:'bor-ai-billing-staging',uuid:id(stagingId)},
    {label:'billing_shadow',name:'bor-ai-billing-shadow',uuid:id(shadowId)}
  ];
  if(entries.some(e=>!e.uuid))throw new Error('dedicated_d1_identifiers_required');
  if(new Set(entries.map(e=>e.uuid)).size!==entries.length)
    throw new Error('d1_identifier_reuse_blocked');
  if(production?.vars?.BOR_BILLING_SHADOW_ENABLED==='true')
    throw new Error('shadow_feature_already_enabled');
  return entries;
}
export async function inspectCloudflareD1Metadata({
  accountId,token,identities,fetcher=fetch
}={}){
  if(typeof accountId!=='string'||!ACCOUNT.test(accountId)||
     typeof token!=='string'||token.length<20||
     !Array.isArray(identities)||identities.length!==4||
     identities.some(x=>!id(x?.uuid)||!/^bor-ai-[a-z-]+$/.test(x?.name||''))||
     new Set(identities.map(x=>x.uuid.toLowerCase())).size!==4)
    throw new Error('read_only_d1_probe_inputs_missing');
  const statuses=[];
  for(const entry of identities){
    const url='https://api.cloudflare.com/client/v4/accounts/'+accountId+
      '/d1/database/'+entry.uuid+'?fields=uuid%2Cname';
    let response,data;
    try{
      response=await fetcher(url,{
        method:'GET',
        headers:{Authorization:'Bearer '+token,Accept:'application/json'},
        redirect:'error',
        signal:AbortSignal.timeout(10000)
      });
      if(response?.status!==200||response?.ok!==true)
        throw new Error('response_not_successful');
      data=await response.json();
    }catch{
      // No upstream response, token, DB id, account id or provider errors in logs.
      throw new Error('cloudflare_d1_metadata_read_failed');
    }
    if(data?.success!==true||data?.result?.name!==entry.name||
       id(data?.result?.uuid)!==entry.uuid.toLowerCase())
      throw new Error('cloudflare_d1_metadata_identity_mismatch');
    statuses.push({label:entry.label,verified:true});
  }
  return {metadataOnly:true,allVerified:true,databaseStatuses:statuses,
    schemaAttestationVerified:false,shadowFeatureEnabled:false,
    liveCreditsEnabled:false,livePaymentsEnabled:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const read=p=>JSON.parse(readFileSync(p,'utf8'));
    const identities=expectedD1Identities({
      production:read('wrangler.jsonc'),
      sandbox:read('wrangler.duitku-sandbox.jsonc'),
      stagingId:process.env.BOR_BILLING_STAGING_D1_ID,
      shadowId:process.env.BOR_BILLING_SHADOW_D1_ID
    });
    const result=await inspectCloudflareD1Metadata({
      accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
      token:process.env.BOR_CLOUDFLARE_D1_READ_TOKEN,
      identities
    });
    for(const item of result.databaseStatuses)
      console.log('D1 metadata identity verified:',item.label);
    console.log('READ-ONLY METADATA VERIFIED. No schema attestation, D1 queries, billing, or deployment performed.');
  }catch(e){
    const allowed=new Set([
      'unexpected_checked_in_d1_layout','dedicated_d1_identifiers_required',
      'd1_identifier_reuse_blocked','shadow_feature_already_enabled',
      'read_only_d1_probe_inputs_missing','cloudflare_d1_metadata_read_failed',
      'cloudflare_d1_metadata_identity_mismatch'
    ]);
    console.error('D1 READ-ONLY PREFLIGHT BLOCKED:',
      allowed.has(e?.message)?e.message:'unexpected_preflight_failure');
    process.exitCode=1;
  }
}
