import {providerHttpError} from './voice-diagnostics.mjs';
// Isolated server gateway candidate. Inject verified server auth, atomic fail-closed reservation, persistent settlement and the primary lifecycle. No live calls are made on import. Not mounted on production.
export function makePrimaryGateway({getSession,ownerId,origin,enabled,reserve,connect,createVoice,settle,waitUntil,randomId}){
  return async function start(request,client){
    const fail=reason=>({ok:false,reason});
    if(!enabled)return fail('disabled');
    if(request.method!=='GET'||request.headers.get('Origin')!==origin||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return fail('invalid_upgrade');
    let user;try{user=await getSession(request)}catch{return fail('auth_unavailable')}
    if(!user||typeof ownerId!=='string'||!ownerId||String(user.id)!==ownerId)return fail('not_authorized');
    if(client.readyState!==1)return fail('client_closed');
    const attemptId=randomId();
    let reserved;try{reserved=await reserve({userId:ownerId,attemptId})}catch{return fail('reservation_unavailable')}
    if(reserved?.ok!==true)return fail(reserved?.reason??'reservation_denied');
    let provider,voice,disconnected=false,finalized=false;
    const onDisconnect=()=>{disconnected=true;voice?.close()};
    const send=event=>{if(!disconnected&&client.readyState===1){try{client.send(JSON.stringify(event))}catch{onDisconnect()}}};
    const final=result=>{
      if(finalized)return;finalized=true;
      for(const [event,handler] of handlers)client.removeEventListener(event,handler);
      const saving=Promise.resolve().then(()=>settle({attemptId,...result})).then(row=>send({type:'final',confirmed:result.confirmed===true&&row?.state==='closed'}),()=>send({type:'final',confirmed:false})).finally(()=>{try{client.close(1000,'voice ended')}catch{}});
      waitUntil(saving);
    };
    let windowStart=Date.now(),bytes=0;
    const onMessage=({data})=>{
      if(disconnected||finalized||!voice||typeof data!=='string'||data.length>17000)return;
      let msg;try{msg=JSON.parse(data)}catch{return}
      if(msg?.type==='stop'){voice.close();return}
      if(msg?.type!=='audio'||typeof msg.audio!=='string'||msg.audio.length>16384)return;
      const now=Date.now();if(now-windowStart>=1000){windowStart=now;bytes=0}
      bytes+=msg.audio.length;if(bytes>100000){voice.close();return}
      voice.appendAudio(msg.audio);
    };
    const handlers=[['close',onDisconnect],['error',onDisconnect],['message',onMessage]];
    for(const [event,handler] of handlers)client.addEventListener(event,handler);
    try{
      if(client.readyState!==1||disconnected){final({confirmed:false,usage:null,latestSeconds:null,sessionId:null});return fail('client_closed')}
      provider=await connect();
      if(disconnected||client.readyState!==1){try{provider.close()}catch{};final({confirmed:false,usage:null,latestSeconds:null,sessionId:null});return fail('client_closed')}
      voice=createVoice({socket:provider,onAudio:delta=>send({type:'audio',delta}),onTranscript:e=>send({type:'transcript',...e}),onState:state=>send({type:'state',state}),onFinal:final});
      if(disconnected)voice.close();
      return {ok:true};
    }catch(error){
      try{provider?.close()}catch{}
      final({confirmed:false,usage:null,latestSeconds:null,sessionId:null,diagnostic:error?.diagnostic??null});
      return fail('provider_unavailable');
    }
  }
}
export async function connectPrimaryProvider({apiKey,fetchImpl=fetch,timeout=ms=>AbortSignal.timeout(ms)}){
  if(typeof apiKey!=='string'||!apiKey||/\s/.test(apiKey))throw Error('missing_provider_key');
  const response=await fetchImpl('https://api.openai.com/v1/live/sessions',{headers:{Authorization:'Bearer '+apiKey,Upgrade:'websocket'},redirect:'manual',signal:timeout(5000)});
  if(response.status!==101||!response.webSocket){await response.body?.cancel().catch(()=>{});throw providerHttpError('provider_upgrade_failed',response,'primary_upgrade')}
  response.webSocket.accept();
  return response.webSocket;
}
