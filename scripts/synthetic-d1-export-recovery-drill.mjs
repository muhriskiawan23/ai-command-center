// A strictly synthetic, owner-approved Cloudflare D1 export/restore drill.
// The ONLY mutation targets are unique D1 databases created by this run.
// Never send production customer data to GitHub Actions, and never touch bor-ai-chat.
import {createHash} from 'node:crypto';

export const ACCOUNT_PIN='1698b70193eb133044e9fb07e39b7740';
export const PRIMARY_D1_PIN='d71231a9-9a04-471c-b904-d1bc843940aa';
export const EXACT_APPROVAL='I_APPROVE_SYNTHETIC_D1_CREATE_EXPORT_RESTORE_CLEANUP';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXPECTED_ROWS=[
  {event_id:'synthetic-0001',kind:'create',payload:'SYNTHETIC_ONLY_CONVERSATION'},
  {event_id:'synthetic-0002',kind:'message',payload:'SYNTHETIC_ONLY_AFTER_SNAPSHOT'},
  {event_id:'synthetic-0003',kind:'delete',payload:'SYNTHETIC_ONLY_TOMBSTONE'},
  {event_id:'synthetic-0004',kind:'message',payload:'SYNTHETIC_ONLY_AFTER_DELETE'}
];
const digest=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');

export function namesForRun(runId) {
  if(!/^[0-9]{6,18}$/.test(String(runId||''))) throw Error('synthetic_drill_run_id_invalid');
  return {
    source:'bor-ai-synth-recovery-'+runId+'-src',
    target:'bor-ai-synth-recovery-'+runId+'-dst'
  };
}
export function validateSyntheticResource(name, uuid, runId) {
  const names=namesForRun(runId);
  if(!Object.values(names).includes(name)||!UUID.test(uuid||'')||uuid===PRIMARY_D1_PIN||
     /bor-ai-chat|production|billing/i.test(name))
    throw Error('synthetic_drill_resource_identity_mismatch');
  return true;
}
export function extractSyntheticSignedUrl(apiResult) {
  if(!apiResult||apiResult.success!==true||!apiResult.result||typeof apiResult.result!=='object')
    throw Error('synthetic_drill_export_envelope_invalid');
  const r=apiResult.result;
  if(r.status==='error'||r.error)throw Error('synthetic_drill_export_provider_error');
  const direct=r.signed_url;
  const nested=r.result?.signed_url;
  if(direct!==undefined&&nested!==undefined&&direct!==nested)
    throw Error('synthetic_drill_conflicting_export_urls');
  const signed=direct!==undefined?direct:nested;
  if(signed===undefined||signed===null)return null;
  if(r.status!==undefined&&r.status!=='complete')
    throw Error('synthetic_drill_export_status_mismatch');
  if(typeof signed!=='string'||signed.length>4096)
    throw Error('synthetic_drill_export_signed_url_invalid');
  return signed;
}
export function approvedSyntheticDownloadHost(raw) {
  let url;
  try{url=new URL(raw);}catch{throw Error('synthetic_drill_signed_url_invalid');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||
     !/^[a-z0-9.-]{1,253}$/.test(host)||!host.endsWith('.r2.cloudflarestorage.com')||
     host==='r2.cloudflarestorage.com')
    throw Error('synthetic_drill_signed_url_host_not_allowlisted');
  return {url:url.toString(),hostname:host};
}
export function validRows(rows) {
  if(!Array.isArray(rows)||rows.length!==EXPECTED_ROWS.length)
    throw Error('synthetic_drill_row_count_mismatch');
  const normalize=x=>({event_id:x.event_id,kind:x.kind,payload:x.payload});
  const actual=rows.map(normalize);
  if(digest(actual)!==digest(EXPECTED_ROWS)||actual[2].kind!=='delete')
    throw Error('synthetic_drill_content_or_tombstone_mismatch');
  return digest(actual);
}

// D1's query endpoint may wrap batched statements in its own transaction.
// For this synthetic-only SQL shape, remove dump-only wrappers and reject
// every statement except CREATE/INSERT of the single known synthetic table.
export function normalizeSyntheticDumpForQuery(dump) {
  if(typeof dump!=='string'||dump.length>1024*1024||
     !dump.includes('SYNTHETIC_ONLY_TOMBSTONE'))throw Error('synthetic_drill_dump_unexpected');
  const statements=dump.split(';').map(x=>x.trim()).filter(Boolean);
  const allowed=[], wrappers=/^(?:BEGIN(?:\s+TRANSACTION)?|COMMIT|END(?:\s+TRANSACTION)?|PRAGMA\s+(?:defer_foreign_keys|foreign_keys)\s*=\s*(?:TRUE|FALSE|ON|OFF|0|1))$/i;
  let creates=0,inserts=0;
  for(const item of statements){
    if(wrappers.test(item))continue;
    if(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'\[]?synth_events\b/i.test(item))creates++;
    else if(/^INSERT\s+INTO\s+["'\[]?synth_events\b/i.test(item))inserts++;
    else throw Error('synthetic_drill_dump_unapproved_sql_statement');
    allowed.push(item);
  }
  if(creates!==1||inserts<1)throw Error('synthetic_drill_dump_schema_or_rows_missing');
  return allowed.join(';\n')+';';
}
function timeDelay(ms) {return new Promise(resolve=>setTimeout(resolve,ms));}

// The HTTP helper never logs response bodies, bearer token, signed URL or SQL.
export async function runSyntheticD1Drill(env,{fetcher=fetch,log=console.log,sleep=timeDelay}={}) {
  if(env?.GITHUB_REPOSITORY!=='muhriskiawan23/ai-command-center'||
     env.GITHUB_REF!=='refs/heads/main'||env.BOR_SYNTHETIC_OWNER_APPROVAL!==EXACT_APPROVAL||
     env.BOR_SYNTHETIC_COST_APPROVED!=='true'||env.CLOUDFLARE_ACCOUNT_ID!==ACCOUNT_PIN||
     !env.BOR_PRIVATE_D1_EXPORT_TOKEN||env.BOR_PRIVATE_D1_EXPORT_TOKEN.length<20)
    throw Error('synthetic_drill_not_owner_approved_or_bad_environment');
  const runId=env.GITHUB_RUN_ID;
  const names=namesForRun(runId);
  const token=env.BOR_PRIVATE_D1_EXPORT_TOKEN;
  const base='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT_PIN+'/d1/database';
  const ids=new Map(), cleanupErrors=[];
  const request=async(method,path,body,context)=>{
    let resp;
    try {
      resp=await fetcher(base+path,{
        method,redirect:'error',signal:AbortSignal.timeout(25000),
        headers:{Authorization:'Bearer '+token,Accept:'application/json',
          ...(body===undefined?{}:{'Content-Type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)})
      });
    } catch {
      throw Error('synthetic_drill_'+context+'_request_unavailable');
    }
    if(!resp.ok)throw Error('synthetic_drill_'+context+'_http_'+resp.status);
    let json;
    try {json=await resp.json();}catch{throw Error('synthetic_drill_'+context+'_invalid_json');}
    if(json?.success!==true||json.errors?.length)
      throw Error('synthetic_drill_'+context+'_api_rejected');
    return json.result;
  };
  const safeCreate=async name=>{
    // The exact names are generated by this run. No existing production D1 is chosen.
    const created=await request('POST','',{name,read_replication:{mode:'disabled'}},'create');
    validateSyntheticResource(created?.name,created?.uuid,runId);
    if(created.name!==name)throw Error('synthetic_drill_created_unexpected_name');
    ids.set(name,created.uuid);
    log('Synthetic D1 created:',name,'uuid:',created.uuid);
    return created.uuid;
  };
  const sqlQuery=async(id,sql,stage)=>{
    if(!Array.from(ids.values()).includes(id)||id===PRIMARY_D1_PIN)
      throw Error('synthetic_drill_query_target_not_created_by_run');
    const result=await request('POST','/'+id+'/query',{sql},stage);
    if(!Array.isArray(result)||result.some(x=>x?.success!==true))
      throw Error('synthetic_drill_'+stage+'_statement_rejected');
    return result;
  };
  const exactRows=async id=>{
    const data=await sqlQuery(id,'SELECT event_id,kind,payload FROM synth_events ORDER BY event_id','inspect');
    if(data.length!==1)throw Error('synthetic_drill_inspect_result_shape_invalid');
    return data[0].results;
  };
  const cleanup=async()=>{
    // Try to locate an ambiguous create by its unique run-scoped name, too.
    try {
      const listed=await request('GET','?per_page=1000',undefined,'cleanup_list');
      if(Array.isArray(listed)){
        for(const x of listed){
          if(Object.values(names).includes(x?.name)&&UUID.test(x.uuid||'')&&x.uuid!==PRIMARY_D1_PIN) {
            if(ids.has(x.name)&&ids.get(x.name)!==x.uuid)
              throw Error('synthetic_drill_cleanup_uuid_conflict');
            ids.set(x.name,x.uuid);
          }
        }
      }
    }catch(error){cleanupErrors.push('cleanup_list_failed');}
    for(const [name,id] of [...ids].reverse()){
      try{
        validateSyntheticResource(name,id,runId);
        // Re-read the resource immediately before deleting; never DELETE by name alone.
        const meta=await request('GET','/'+id,undefined,'cleanup_attest');
        if(meta?.name!==name||meta?.uuid!==id)
          throw Error('synthetic_drill_cleanup_identity_mismatch');
        await request('DELETE','/'+id,undefined,'cleanup_delete');
        log('Synthetic-only D1 deleted:',name,'uuid:',id);
      }catch(error){
        cleanupErrors.push('cleanup_failed_for_'+name);
        log('SYNTHETIC CLEANUP INCOMPLETE for',name,'uuid:',id);
      }
    }
  };
  let outcome=null, primaryError=null;
  try {
    const source=await safeCreate(names.source);
    const init=[
      'CREATE TABLE synth_events(event_id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL)',
      ...EXPECTED_ROWS.map(r=>
        "INSERT INTO synth_events(event_id,kind,payload) VALUES('"+
        r.event_id+"','"+r.kind+"','"+r.payload+"')")
    ].join(';')+';';
    await sqlQuery(source,init,'seed');
    const originalHash=validRows(await exactRows(source));
    log('Synthetic source verified: 4 events incl. deletion tombstone. No real messages.');

    // Only the run-scoped source D1 ID ever appears in the export URL.
    let exportResponse=await request('POST','/'+source+'/export',
      {output_format:'polling'},'export_start');
    if(!exportResponse||typeof exportResponse.at_bookmark!=='string'||
       exportResponse.at_bookmark.length<12)
      throw Error('synthetic_drill_export_bookmark_missing');
    const bookmark=exportResponse.at_bookmark;
    let signed=extractSyntheticSignedUrl({success:true,result:exportResponse});
    for(let i=0;!signed&&i<20;i++){
      await sleep(2000);
      // D1 requires output_format='polling' on EVERY export POST,
      // including continuation. A missing field previously broke live backup.
      exportResponse=await request('POST','/'+source+'/export',
        {output_format:'polling',current_bookmark:bookmark},'export_poll');
      if(exportResponse.at_bookmark!==undefined&&exportResponse.at_bookmark!==bookmark)
        throw Error('synthetic_drill_export_bookmark_changed');
      signed=extractSyntheticSignedUrl({success:true,result:exportResponse});
    }
    if(!signed)throw Error('synthetic_drill_export_poll_limit');

    let link;
    try{link=approvedSyntheticDownloadHost(signed);}
    catch(error){
      // Log hostname ONLY (not the signed query or the private download).
      try{const host=new URL(signed).hostname;log('Cloudflare signed export host observed:',host);}
      catch{log('Cloudflare signed export host invalid');}
      throw error;
    }
    log('Cloudflare signed export host independently observed on SYNTHETIC D1:',link.hostname);
    // For synthetic data ONLY, fetch the signed dump. No user chat on this DB.
    let response;
    try{response=await fetcher(link.url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(25000)});}
    catch{throw Error('synthetic_drill_dump_download_unavailable');}
    if(!response.ok||!response.body)throw Error('synthetic_drill_dump_download_failed');
    if(Number(response.headers.get('Content-Length')||0)>1024*1024)
      throw Error('synthetic_drill_dump_oversized');
    const reader=response.body.getReader();const chunks=[];let total=0;
    try{
      for(;;){
        const {done,value}=await reader.read();if(done)break;
        if(!(value instanceof Uint8Array))throw Error('synthetic_drill_dump_not_binary');
        total+=value.byteLength;
        if(total>1024*1024)throw Error('synthetic_drill_dump_oversized');
        chunks.push(value);
      }
    }finally{await reader.cancel().catch(()=>{});}
    const dump=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
    if(total<60||!/\bCREATE\s+TABLE\s+["'\[]?synth_events\b/i.test(dump)||
       !dump.includes('SYNTHETIC_ONLY_TOMBSTONE')||dump.includes('bor-ai-chat'))
      throw Error('synthetic_drill_export_content_unexpected');
    // A distinct, newly created D1 is the ONLY import target.
    const target=await safeCreate(names.target);
    await sqlQuery(target,normalizeSyntheticDumpForQuery(dump),'restore');
    const restoredHash=validRows(await exactRows(target));
    if(restoredHash!==originalHash)throw Error('synthetic_drill_recovery_checksum_mismatch');
    outcome={success:true,host:link.hostname,syntheticEvents:4,
      deletedTombstonePreserved:true,restoredSha256:restoredHash,
      sourcePrimaryTouched:false,customerChatRead:false,productionRestore:false};
    log('SYNTHETIC D1 EXPORT/RESTORE VERIFIED:',JSON.stringify(outcome));
  }catch(error){
    primaryError=error;
    log('SYNTHETIC D1 DRILL BLOCKED:',String(error?.message||'error').slice(0,140));
  }finally{
    await cleanup();
  }
  if(cleanupErrors.length)throw Error('synthetic_drill_cleanup_incomplete_'+cleanupErrors.join('_'));
  if(primaryError)throw primaryError;
  return {...outcome,syntheticResourcesCleanedUp:true};
}
if(process.argv[1]&&import.meta.url.endsWith('/'+process.argv[1].split('/').pop())){
  runSyntheticD1Drill(process.env).then(
    r=>console.log('Synthetic D1 drill final verified receipt:',JSON.stringify(r)),
    e=>{console.error('SYNTHETIC DRILL STOPPED:',String(e?.message||'unknown'));process.exitCode=1;}
  );
}
