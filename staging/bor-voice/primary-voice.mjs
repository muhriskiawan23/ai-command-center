// Server-side primary WebSocket lifecycle candidate. Requires verified authorization, atomic reservation and connected provider socket before invocation. No connection or paid request is made by importing this module. Local deadline is not a provider-guaranteed spend cap.
export function createPrimaryVoice({socket, onAudio=()=>{}, onState=()=>{}, onFinal=()=>{}, onTranscript=()=>{}, schedule=setTimeout, cancel=clearTimeout, durationMs=60000, graceMs=15000}){
  if (!socket || !Number.isSafeInteger(durationMs) || durationMs<1000 || durationMs>60000 || !Number.isSafeInteger(graceMs) || graceMs<1000 || graceMs>15000) throw Error('invalid_primary_config');
  let state='starting', id=null, seconds=0, deadline, grace;
  const emit = (value)=>{state=value; onState(value)};
  const send = event=>socket.send(JSON.stringify(event));
  function finish(confirmed, usage=null){
    if(state==='finished')return;
    state='finished';cancel(deadline);cancel(grace);
    for(const [event,handler] of listeners)socket.removeEventListener(event,handler);
    try{socket.close(1000,'voice ended')}catch{}
    onFinal({confirmed,sessionId:id,latestSeconds:seconds,usage});
    onState(confirmed?'closed':'unconfirmed');
  }
  function close(){
    if(state==='finished'||state==='closing')return;
    emit('closing');cancel(deadline);
    grace=schedule(()=>finish(false),graceMs);
    try{send({type:'session.close'})}catch{finish(false)}
  }
  function message({data}){
    if(typeof data!=='string'||data.length>262144)return;
    let e;try{e=JSON.parse(data)}catch{return}
    if(e?.type==='session.started'&&state==='starting'){
      if(e.session?.model!=='gpt-live-1.1'||!/^live_[A-Za-z0-9_-]{1,128}$/.test(e.session?.id??'')){close();return}
      id=e.session.id;emit('active');return;
    }
    if(e?.type==='session.usage.updated'&&id&&typeof e.usage?.seconds==='number'&&Number.isFinite(e.usage.seconds)&&e.usage.seconds>=seconds){seconds=e.usage.seconds;return}
    if(e?.type==='session.closed'){
      if(!id||e.session?.id!==id||e.session?.model!=='gpt-live-1.1'||typeof e.usage?.seconds!=='number'||!Number.isFinite(e.usage.seconds)||e.usage.seconds<seconds){finish(false);return}
      seconds=e.usage.seconds;finish(true,{seconds});return;
    }
    if(state!=='active')return;
    if(e?.type==='session.output_audio.delta'&&typeof e.delta==='string'&&e.delta.length<=131072)onAudio(e.delta);
    if((e?.type==='session.input_transcript.delta'||e?.type==='session.output_transcript.delta')&&typeof e.delta==='string'&&e.delta.length<=8192)onTranscript({type:e.type,delta:e.delta});
    if(e?.type==='error')close();
  }
  const disconnected=()=>finish(false);
  const listeners=[['message',message],['close',disconnected],['error',disconnected]];
  for(const [event,handler] of listeners)socket.addEventListener(event,handler);
  deadline=schedule(close,durationMs);
  try{send({type:'session.start',session:{model:'gpt-live-1.1',instructions:'You are BOR AI Voice. Speak naturally in the user language. Conversation only; never claim to use external tools.',store:false,audio:{format:{type:'audio/pcm',rate:24000},output:{voice:'marin'}},delegation:{type:'client'}}})}catch{finish(false)}
  return {close,getState:()=>state,appendAudio(audio){
    if(state!=='active'||typeof audio!=='string'||audio.length===0||audio.length>16384||audio.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(audio))return false;
    try{send({type:'session.input_audio.append',audio});return true}catch{close();return false}
  }};
}
