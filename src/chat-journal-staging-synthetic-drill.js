// CLOSED Cloudflare-only synthetic staging exercise. Not a customer chat API.
// Invoked exclusively from a manually triggered Workflow in the isolated Worker.
// Never return or log secret, SQL rows, prompt payloads or real account IDs.
const PURPOSE='BOR_SYNTHETIC_CLOSED_JOURNAL_DRILL_V1';
const fail=code=>{throw Error(code);};
export function isApprovedClosedJournalDrill(payload,instanceId){
  return payload && typeof payload==='object' && !Array.isArray(payload) &&
    Object.keys(payload).length===1 && payload.purpose===PURPOSE &&
    typeof instanceId==='string' && /^[a-zA-Z0-9-]{12,95}$/.test(instanceId);
}
export async function executeClosedSyntheticJournalDrill(env,{payload,instanceId}){
  if(!isApprovedClosedJournalDrill(payload,instanceId))fail('staging_drill_not_approved');
  if(env?.CHAT_JOURNAL_ACTIVE!=='false'||
    env?.CHAT_JOURNAL_STAGING_SYNTHETIC_ONLY!=='true'||
    typeof env?.CHAT_JOURNAL_INTERNAL_SECRET!=='string'||
    env.CHAT_JOURNAL_INTERNAL_SECRET.length<32||
    !env.CHAT_JOURNAL?.idFromName||!env.CHAT_JOURNAL?.get)
    fail('staging_drill_private_bindings_unavailable');
  const id=env.CHAT_JOURNAL.idFromName('bor-ai-synthetic-only-'+instanceId);
  const stub=env.CHAT_JOURNAL.get(id);
  const token=env.CHAT_JOURNAL_INTERNAL_SECRET;
  const user='synthetic-do-user-'+instanceId;
  const conversation='synthetic-do-chat-'+instanceId;
  const fetchPrivate=async(path,kind,method='GET')=>{
    let response;
    try {
      response=await stub.fetch(new Request('https://journal.internal'+path,{
        method,headers:{'X-BOR-Journal-Token':token,...(kind?{'Content-Type':'application/json'}:{})},
        ...(kind?{body:JSON.stringify(kind)}:{})
      }));
    }catch{fail('staging_do_private_request_failed');}
    let body;
    try{body=await response.json();}catch{fail('staging_do_private_response_invalid');}
    return {status:response.status,body};
  };
  const append=async(event_id,kind,payload)=>{
    const result=await fetchPrivate('/append',{event_id,kind,user_id:user,payload},'POST');
    if(result.status!==200||result.body?.ok!==true||result.body.duplicate!==false)
      fail('staging_do_append_failed_'+kind.replaceAll('.','_'));
    return result.body.seq;
  };
  const event=(event_id,kind,payload={})=>({event_id,kind,user_id:user,payload});
  const retry=async(e,seq)=>{
    const result=await fetchPrivate('/append',e,'POST');
    if(result.status!==200||result.body?.duplicate!==true||result.body.seq!==seq)
      fail('staging_do_idempotency_failed');
  };
  // All fields and content are fake fixed markers. One isolated DO per unique
  // Workflow instance. No account-derived keys or production D1 queries.
  await append('a1','account.created',{});
  await append('c2','conversation.created',{conversation_id:conversation,title:'SYNTHETIC_TITLE_ONLY'});
  await append('m3','message.saved',{conversation_id:conversation,message_id:'synthetic-user-msg',
    role:'user',content:'SYNTHETIC_USER_ONLY'});
  await append('m4','message.saved',{conversation_id:conversation,message_id:'synthetic-assistant-msg',
    role:'assistant',content:'SYNTHETIC_ASSISTANT_ONLY'});
  await append('f5','feedback.set',{conversation_id:conversation,message_id:'synthetic-assistant-msg',
    rating:'helpful',reason:'SYNTHETIC_FEEDBACK_ONLY'});
  await append('u6','conversation.updated',{conversation_id:conversation,pinned:true});
  const seq7=await append('d7','conversation.deleted',{conversation_id:conversation});
  await retry(event('d7','conversation.deleted',{conversation_id:conversation}),seq7);
  const stale=await fetchPrivate('/append',event('stale','message.saved',{
    conversation_id:conversation,message_id:'stale-msg',role:'user',content:'SHOULD_NOT_BE_ACCEPTED'
  }),'POST');
  if(stale.status!==409||stale.body?.code!=='deleted_conversation')
    fail('staging_do_stale_chat_not_blocked');
  const freshConversation='synthetic-new-chat-'+instanceId;
  await append('c8','conversation.created',{conversation_id:freshConversation,title:'SYNTHETIC_NEW_CHAT'});
  await append('m9','message.saved',{conversation_id:freshConversation,message_id:'synthetic-new-msg',
    role:'user',content:'SYNTHETIC_AFTER_DELETION'});
  const seq10=await append('d10','account.deleted',{});
  await retry(event('d10','account.deleted',{}),seq10);
  const read=await fetchPrivate('/read?after=0&limit=15&expectedHead=10');
  const events=read.body?.events;
  if(read.status!==200||read.body?.ok!==true||read.body.head!==10||
    !Array.isArray(events)||events.length!==10||
    events.some((x,i)=>x.seq!==i+1)||
    events.slice(0,-1).some(x=>x.redacted!==1||x.payload_json!=='{}')||
    events[9].kind!=='account.deleted'||events[9].redacted!==0)
    fail('staging_do_durable_redaction_or_order_failed');
  const erased=JSON.stringify(events);
  for(const marker of ['SYNTHETIC_TITLE_ONLY','SYNTHETIC_USER_ONLY',
    'SYNTHETIC_ASSISTANT_ONLY','SYNTHETIC_FEEDBACK_ONLY','SYNTHETIC_NEW_CHAT',
    'SYNTHETIC_AFTER_DELETION']){
    if(erased.includes(marker))fail('staging_do_deleted_payload_remains');
  }
  // No user text or even the synthetic marker content in Workflow receipt.
  return Object.freeze({passed:true,isolated:true,publicChatAccess:false,
    independentSQLite:true,syntheticOnly:true,events:10,
    erasedPayloadEvents:9,duplicateDeletionRetriesVerified:2,
    staleMutationBlocked:true,head:10,customerDataAccessed:false,
    productionD1Accessed:false});
}
