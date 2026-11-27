import {decodePcm} from './primary-pcm.mjs';
// Same-origin, user-initiated primary voice browser client. No auto retry of uncertain paid sessions.
export function createPrimaryBrowser({endpoint='/api/voice/primary',onState=()=>{},onTranscript=()=>{},media=()=>navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false}),context=()=>new AudioContext({latencyHint:'interactive'}),worklet=(ctx)=>new AudioWorkletNode(ctx,'bor-primary-capture',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]}),socket=()=>{const url=new URL(endpoint,location.origin);if(url.origin!==location.origin||url.protocol!=='https:')throw Error('invalid_voice_origin');url.protocol='wss:';return new WebSocket(url)},encode=bytes=>btoa(String.fromCharCode(...bytes)),decode=text=>decodePcm(Uint8Array.from(atob(text),c=>c.charCodeAt(0))),events=globalThis.window,schedule=setTimeout,cancel=clearTimeout}={}){
 let run=null;
 const stopTracks=stream=>stream?.getTracks().forEach(t=>t.stop());
 function releaseAudio(r){
  stopTracks(r.stream);r.stream=null;
  try{r.capture?.port.postMessage(false);r.capture?.disconnect();r.source?.disconnect()}catch{}
  for(const node of r.playing){try{node.stop()}catch{}}
  r.playing.clear();
  try{r.ctx?.close().catch(()=>{})}catch{}
 }
 function finish(r,state){
  if(run!==r)return;
  run=null;cancel(r.timer);events?.removeEventListener('offline',r.offline);events?.removeEventListener('pagehide',r.offline);releaseAudio(r);
  try{r.ws?.close(1000,'voice ended')}catch{}
  onState(state);
 }
 function close(r){
  if(run!==r||r.closing)return;
  r.closing=true;cancel(r.timer);releaseAudio(r);onState('closing');
  if(r.ws?.readyState!==1){finish(r,'unconfirmed');return}
  r.timer=schedule(()=>finish(r,'unconfirmed'),17000);
  try{r.ws.send(JSON.stringify({type:'stop'}))}catch{finish(r,'unconfirmed')}
 }
 function play(r,data){
  if(run!==r||r.closing||!r.active||typeof data!=='string'||data.length>131072)return;
  try{
   const pcm=decode(data);const ctx=r.ctx;
   if(!pcm.length||pcm.length>24000*2)throw Error('oversized_audio');
   const start=Math.max(ctx.currentTime+0.015,r.nextPlayback??0);
   if(start+pcm.length/24000-ctx.currentTime>1.5)throw Error('playback_backlog');
   const buffer=ctx.createBuffer(1,pcm.length,24000);buffer.copyToChannel(pcm,0);
   const node=ctx.createBufferSource();node.buffer=buffer;node.connect(ctx.destination);r.playing.add(node);node.onended=()=>{r.playing.delete(node);node.disconnect()};node.start(start);r.nextPlayback=start+pcm.length/24000;
  }catch{close(r)}
 }
 async function start(){
  if(run)return false;
  const r={playing:new Set(),active:false,closing:false};run=r;
  r.offline=()=>finish(r,'unconfirmed');
  events?.addEventListener('offline',r.offline);events?.addEventListener('pagehide',r.offline);
  r.timer=schedule(()=>finish(r,'timeout'),25000);
  onState('connecting');
  try{
   r.ctx=context();await r.ctx.resume();if(run!==r)return false;
   const stream=await media();if(run!==r){stopTracks(stream);return false}
   r.stream=stream;await r.ctx.audioWorklet.addModule('/primary-capture.mjs');if(run!==r)return false;
   r.capture=worklet(r.ctx);r.source=r.ctx.createMediaStreamSource(stream);r.source.connect(r.capture);r.capture.connect(r.ctx.destination);
   const ws=r.ws=socket();
   r.capture.port.onmessage=({data})=>{
    if(run!==r||r.closing||!r.active||ws.readyState!==1||!(data instanceof Uint8Array)||data.length!==960)return;
    if(ws.bufferedAmount>96000){close(r);return}
    try{ws.send(JSON.stringify({type:'audio',audio:encode(data)}))}catch{close(r)}
   };
   ws.addEventListener('message',({data})=>{
    if(run!==r||typeof data!=='string'||data.length>140000)return;
    let e;try{e=JSON.parse(data)}catch{return}
    if(e?.type==='final'){finish(r,e.confirmed===true?'closed':'unconfirmed');return}
    if(e?.type==='state'&&e.state==='closing'){if(!r.closing){r.closing=true;cancel(r.timer);releaseAudio(r);onState('closing');r.timer=schedule(()=>finish(r,'unconfirmed'),17000)}return}
    if(r.closing)return;
    if(e?.type==='state'&&e.state==='active'&&!r.active){r.active=true;cancel(r.timer);r.capture.port.postMessage(true);onState('listening');return}
    if(e?.type==='audio')play(r,e.delta);
    if(r.active&&['session.input_transcript.delta','session.output_transcript.delta'].includes(e?.type)&&typeof e.delta==='string'&&e.delta.length<=8192)onTranscript({role:e.type.includes('input_')?'user':'assistant',delta:e.delta});
   });
   ws.addEventListener('close',()=>finish(r,'unconfirmed'));ws.addEventListener('error',()=>finish(r,'unconfirmed'));
   return true;
  }catch(e){finish(r,e?.name==='NotAllowedError'?'denied':'error');return false}
 }
 return {start,stop(){if(run)close(run)},abort(){if(run)finish(run,'unconfirmed')}};
}
