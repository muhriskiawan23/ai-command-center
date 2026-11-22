// Account-side ONLY. This module is inert unless the isolated Workflow is
// independently deployed, approved, provisioned and explicitly triggered.
// Raw user chat must NEVER enter GitHub runners, artifacts, public responses,
// logs, other vendor storage or an ordinary Worker request handler.
export const PINNED_D1_ID='d71231a9-9a04-471c-b904-d1bc843940aa';
export const MAX_DUMP_BYTES=64*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT=/^[0-9a-f]{32}$/i;
const INSTANCE=/^[A-Za-z0-9_-]{8,128}$/;
const hostAllowed=h=>typeof h==='string'&&h.length<254&&/^[a-z0-9.-]+$/.test(h)&&
  h.endsWith('.r2.cloudflarestorage.com')&&h!=='r2.cloudflarestorage.com';

export function verifyPrivateBackupPreflight(env,event){
  if(env?.BOR_BACKUP_ENABLED!=='true'||env?.BOR_BACKUP_OWNER_APPROVED!=='true')
    throw Error('private_backup_disabled');
  if(env.BOR_BACKUP_ACCOUNT_ID===undefined||!ACCOUNT.test(env.BOR_BACKUP_ACCOUNT_ID)||
     env.BOR_BACKUP_DATABASE_ID!==PINNED_D1_ID||
     !UUID.test(env.BOR_BACKUP_DATABASE_ID))
    throw Error('private_backup_d1_identity_mismatch');
  if(typeof env.BOR_D1_EXPORT_TOKEN!=='string'||env.BOR_D1_EXPORT_TOKEN.length<24)
    throw Error('private_backup_export_secret_missing');
  if(!env.PRIVATE_BACKUP_BUCKET||
     typeof env.PRIVATE_BACKUP_BUCKET.put!=='function'||
     typeof env.PRIVATE_BACKUP_BUCKET.head!=='function')
    throw Error('private_backup_r2_binding_missing');
  if(!hostAllowed(env.BOR_SIGNED_EXPORT_HOST))
    throw Error('private_backup_signed_host_not_reviewed');
  if(event?.payload?.purpose!=='owner-approved-private-backup'||
     Object.keys(event.payload).length!==1||
     !INSTANCE.test(event.instanceId||''))
    throw Error('private_backup_manual_trigger_invalid');
  return {account:env.BOR_BACKUP_ACCOUNT_ID,db:env.BOR_BACKUP_DATABASE_ID,
    instance:event.instanceId,host:env.BOR_SIGNED_EXPORT_HOST};
}

export function verifySignedExportUrl(raw,hostname){
  let url;
  try{url=new URL(raw);}catch{throw Error('private_backup_signed_url_invalid');}
  if(url.protocol!=='https:'||url.hostname!==hostname||!hostAllowed(url.hostname)||
     url.port||url.username||url.password||url.hash||raw.length>4096)
    throw Error('private_backup_signed_url_not_approved');
  return url.toString();
}

export function verifyExportEnvelope(data,expectedBookmark=null){
  if(!data||data.success!==true||!data.result||
     typeof data.result!=='object'||data.result.success===false)
    throw Error('private_backup_export_api_failed');
  const r=data.result;
  if(r.status==='error'||r.error)throw Error('private_backup_export_api_failed');
  if(expectedBookmark!==null){
    if(r.at_bookmark!==expectedBookmark)throw Error('private_backup_export_bookmark_changed');
    if(r.status==='complete'){
      const signed=r.result?.signed_url;
      if(typeof signed!=='string'||!signed)throw Error('private_backup_export_missing_url');
      return {status:'complete',signedUrl:signed};
    }
    if(r.status===undefined||r.status==='polling'||r.status==='in_progress')
      return {status:'pending'};
    throw Error('private_backup_export_unknown_status');
  }
  if(typeof r.at_bookmark!=='string'||r.at_bookmark.length<12||
     r.at_bookmark.length>250||!/^[-A-Za-z0-9_]+$/.test(r.at_bookmark))
    throw Error('private_backup_export_missing_bookmark');
  return {bookmark:r.at_bookmark};
}
export function createPrivateBackupKey(instanceId,date){
  if(!INSTANCE.test(instanceId)||!Number.isFinite(date.getTime()))
    throw Error('private_backup_key_invalid');
  return 'private/bor-ai-chat/'+date.toISOString().slice(0,10)+'/'+instanceId+'.sql';
}

async function callExport(fetcher,api,token,body){
  let response;
  try{
    response=await fetcher(api,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(25_000),
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body:JSON.stringify(body)
    });
  }catch{throw Error('private_backup_export_request_failed');}
  if(!response.ok)throw Error('private_backup_export_api_unavailable');
  let data;
  try{data=await response.json();}catch{throw Error('private_backup_export_invalid_json');}
  return data;
}

function sizeBoundedStream(source,maxBytes=MAX_DUMP_BYTES){
  let total=0;
  return source.pipeThrough(new TransformStream({
    transform(chunk,controller){
      if(!(chunk instanceof Uint8Array))throw Error('private_backup_dump_not_binary');
      total+=chunk.byteLength;
      if(total>maxBytes)throw Error('private_backup_dump_too_large');
      controller.enqueue(chunk);
    },
    flush(){if(total===0)throw Error('private_backup_dump_empty');}
  }));
}

// The callback only ever returns a bookmark and *non-content* verification
// receipt. A signed dump URL is never returned from a step, logged or put in
// the workflow output, and is fetched only inside the Cloudflare Worker.
export async function runPrivateBackup({env,event,step,fetcher=fetch,now=()=>new Date()}){
  const c=verifyPrivateBackupPreflight(env,event);
  const api='https://api.cloudflare.com/client/v4/accounts/'+c.account+
    '/d1/database/'+c.db+'/export';
  const exportState=await step.do('start pinned D1 private export',
    // Initiating an export may briefly block primary D1 requests; do not
    // retry an ambiguous start automatically. Require explicit operator review.
    {retries:{limit:0,delay:'10 seconds',backoff:'constant'},timeout:'40 seconds'},
    async()=>{
      const result=verifyExportEnvelope(await callExport(fetcher,api,env.BOR_D1_EXPORT_TOKEN,
        {output_format:'polling',dump_options:{compatibility:'d1'}}));
      // Persist the object key with its export bookmark; a restarted Workflow
      // must reuse exactly the same key even if UTC date changes meanwhile.
      return {bookmark:result.bookmark,key:createPrivateBackupKey(c.instance,now())};
    });
  const bookmark=exportState.bookmark;
  const key=exportState.key;
  const receipt=await step.do('poll private D1 export and stream to private R2',
    {retries:{limit:15,delay:'10 seconds',backoff:'constant'},timeout:'7 minutes'},
    async()=>{
      const state=verifyExportEnvelope(await callExport(fetcher,api,env.BOR_D1_EXPORT_TOKEN,
        {current_bookmark:bookmark}),bookmark);
      if(state.status==='pending')throw Error('private_backup_export_pending');
      const url=verifySignedExportUrl(state.signedUrl,c.host);
      let response;
      try{response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(35_000)});}
      catch{throw Error('private_backup_dump_unavailable');}
      if(!response.ok||!response.body)throw Error('private_backup_dump_unavailable');
      const rawLength=response.headers.get('Content-Length');
      if(rawLength!==null&&(!/^\d+$/.test(rawLength)||Number(rawLength)<1||
         Number(rawLength)>MAX_DUMP_BYTES))
        throw Error('private_backup_dump_size_out_of_bounds');
      const type=(response.headers.get('Content-Type')||'').toLowerCase();
      if(type.includes('text/html')||type.includes('application/json'))
        throw Error('private_backup_dump_wrong_content_type');
      // R2 is the only storage for chat SQL; transport stays inside Cloudflare.
      // A failure of this stream aborts the put and is retried using the same
      // deterministic object key (never a public file or GitHub artifact).
      const stored=await env.PRIVATE_BACKUP_BUCKET.put(
        key,sizeBoundedStream(response.body),
        {httpMetadata:{contentType:'application/sql'},customMetadata:{
          source:'bor-ai-chat',workflowInstance:c.instance,format:'d1-sql'
        }});
      if(!stored||!Number.isSafeInteger(stored.size)||stored.size<1||
         stored.size>MAX_DUMP_BYTES)
        throw Error('private_backup_r2_write_unverified');
      const actual=await env.PRIVATE_BACKUP_BUCKET.head(key);
      if(!actual||actual.size!==stored.size||actual.size<1)
        throw Error('private_backup_r2_head_mismatch');
      return {key,bytes:actual.size,stored:true}; // No chat, token or signed URL
    });
  return {ok:receipt.stored===true,privateR2:true,objectKey:receipt.key,
    bytes:receipt.bytes,instanceId:c.instance,readOnlySource:true,
    sourceD1Unchanged:true,restorePerformed:false,
    customerDataIncludedInOutput:false};
}
