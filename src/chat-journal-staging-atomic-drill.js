// CLOSED internal Cloudflare Workflow ONLY. A new isolated DO per synthetic run.
// Never import into the live chat Worker or expose a public reader/append route.
// All content is hardcoded fake text, no real user identifiers or billable AI.
export const ATOMIC_SYNTHETIC_PURPOSE='BOR_SYNTHETIC_CLOSED_ATOMIC_TURN_DRILL_V2';
const fail=code=>{throw Error(code);};
export const approvedAtomicSyntheticDrill=(payload,instanceId)=>
  payload!==null&&typeof payload==='object'&&!Array.isArray(payload)&&
  Object.keys(payload).length===1&&payload.purpose===ATOMIC_SYNTHETIC_PURPOSE&&
  typeof instanceId==='string'&&/^[A-Za-z0-9-]{12,95}$/.test(instanceId);

export async function executeClosedAtomicSyntheticJournalDrill(env,{payload,instanceId}={}){
  if(!approvedAtomicSyntheticDrill(payload,instanceId))fail('atomic_staging_drill_not_approved');
  if(env?.CHAT_JOURNAL_ACTIVE!=='false'||
     env?.CHAT_JOURNAL_STAGING_SYNTHETIC_ONLY!=='true'||
     typeof env?.CHAT_JOURNAL_INTERNAL_SECRET!=='string'||
     env.CHAT_JOURNAL_INTERNAL_SECRET.length<32||
     !env?.CHAT_JOURNAL?.idFromName||!env?.CHAT_JOURNAL?.get)
    fail('atomic_staging_private_bindings_unavailable');

  const objectId=env.CHAT_JOURNAL.idFromName('bor-ai-synthetic-atomic-'+instanceId);
  const stub=env.CHAT_JOURNAL.get(objectId);
  const user_id='synthetic-atomic-user-'+instanceId;
  const conversation_id='synthetic-atomic-chat-'+instanceId;
  const internalToken=env.CHAT_JOURNAL_INTERNAL_SECRET;
  async function privateFetch(path,event=null){
    let response;
    try{
      response=await stub.fetch(new Request('https://journal.internal'+path,{
        method:event===null?'GET':'POST',
        headers:{'X-BOR-Journal-Token':internalToken,
          ...(event===null?{}:{'Content-Type':'application/json'})},
        ...(event===null?{}:{body:JSON.stringify(event)})
      }));
    }catch{fail('atomic_staging_private_request_failed');}
    let body;
    try{body=await response.json();}catch{fail('atomic_staging_private_response_failed');}
    return {status:response.status,body};
  }
  const event=(event_id,kind,payload={})=>({event_id,user_id,kind,payload});
  const post=ev=>privateFetch('/append',ev);
  async function append(ev,expectedSeq){
    const response=await post(ev);
    if(response.status!==200||response.body?.ok!==true||
       response.body.duplicate!==false||response.body.seq!==expectedSeq)
      fail('atomic_staging_append_failed');
  }
  async function repeated(ev,seq){
    const response=await post(ev);
    if(response.status!==200||response.body?.ok!==true||
       response.body.duplicate!==true||response.body.seq!==seq)
      fail('atomic_staging_duplicate_receipt_failed');
  }
  async function rejected(ev,status,code){
    const response=await post(ev);
    if(response.status!==status||response.body?.code!==code)
      fail('atomic_staging_guard_failed');
  }
  const turn=(conversation,requestId,userMessageId,assistantMessageId)=>({
    conversation_id:conversation,request_id:requestId,
    user_message_id:userMessageId,assistant_message_id:assistantMessageId,
    user_content:'SYNTHETIC_ATOMIC_QUESTION_ONLY',
    assistant_content:'SYNTHETIC_ATOMIC_ANSWER_ONLY',
    created_at:1780001234,
    links_json:JSON.stringify([{
      url:'https://example.invalid/fake-citation',
      title:'SYNTHETIC_CITATION_TITLE'
    }])
  });

  await append(event('owner-1','account.created'),1);
  await append(event('chat-2','conversation.created',{
    conversation_id,title:'SYNTHETIC_ATOMIC_CHAT_TITLE'
  }),2);
  const firstTurn=event('atomic-3','turn.saved',
    turn(conversation_id,'synthetic-request-one',
      'synthetic-question-one','synthetic-answer-one'));
  await append(firstTurn,3);
  await repeated(firstTurn,3);
  await rejected(event('atomic-different-id','turn.saved',
    turn(conversation_id,'synthetic-request-one',
      'synthetic-question-different','synthetic-answer-different')),
    409,'journal_request_id_reused');
  const halfTurn=turn(conversation_id,'synthetic-request-half',
    'synthetic-question-half','synthetic-answer-half');
  delete halfTurn.assistant_message_id;
  await rejected(event('atomic-half','turn.saved',halfTurn),400,'invalid_event');
  await append(event('feedback-4','feedback.set',{
    conversation_id,message_id:'synthetic-answer-one',
    rating:'helpful',reason:'SYNTHETIC_FEEDBACK_ONLY'
  }),4);
  await append(event('update-5','conversation.updated',{
    conversation_id,pinned:true
  }),5);
  const eraseConversation=event('erase-6','conversation.deleted',{conversation_id});
  await append(eraseConversation,6);
  await repeated(eraseConversation,6);
  await rejected(event('atomic-stale','turn.saved',
    turn(conversation_id,'synthetic-request-stale',
      'synthetic-question-stale','synthetic-answer-stale')),
    409,'deleted_conversation');

  const newConversationId='synthetic-atomic-newchat-'+instanceId;
  await append(event('newchat-7','conversation.created',{
    conversation_id:newConversationId,title:'SYNTHETIC_NEW_ATOMIC_CHAT_TITLE'
  }),7);
  await append(event('newturn-8','turn.saved',
    turn(newConversationId,'synthetic-request-two',
      'synthetic-question-two','synthetic-answer-two')),8);
  const eraseAccount=event('erase-9','account.deleted');
  await append(eraseAccount,9);
  await repeated(eraseAccount,9);

  const read=await privateFetch('/read?after=0&limit=15&expectedHead=9');
  const events=read.body?.events;
  if(read.status!==200||read.body?.ok!==true||read.body.head!==9||
    !Array.isArray(events)||events.length!==9||
    events.some((e,index)=>e.seq!==index+1)||
    events[2].kind!=='turn.saved'||events[7].kind!=='turn.saved'||
    events.slice(0,-1).some(e=>e.redacted!==1||e.payload_json!=='{}')||
    events[8].kind!=='account.deleted'||events[8].redacted!==0)
    fail('atomic_staging_durability_or_redaction_failed');
  const serialized=JSON.stringify(events);
  for(const marker of [
    'SYNTHETIC_ATOMIC_QUESTION_ONLY','SYNTHETIC_ATOMIC_ANSWER_ONLY',
    'SYNTHETIC_CITATION_TITLE','SYNTHETIC_FEEDBACK_ONLY',
    'SYNTHETIC_ATOMIC_CHAT_TITLE','SYNTHETIC_NEW_ATOMIC_CHAT_TITLE',
    'https://example.invalid/fake-citation'
  ]){
    if(serialized.includes(marker))fail('atomic_staging_deleted_content_visible');
  }
  // This receipt contains only safe boolean/count evidence, no raw payloads.
  return Object.freeze({
    passed:true,drillVersion:2,isolated:true,syntheticOnly:true,
    publicChatAccess:false,independentSQLite:true,
    head:9,events:9,atomicTurns:2,erasedPayloadEvents:8,
    duplicateRetriesVerified:3,requestConflictBlocked:true,
    halfTurnBlocked:true,staleMutationBlocked:true,
    customerDataAccessed:false,productionD1Accessed:false
  });
}
