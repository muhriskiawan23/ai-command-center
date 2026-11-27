import {createPrimaryBrowser} from '../../../public/primary-browser.mjs';
async function runBrowserTests(create){
 const assert=v=>{if(!v)throw Error('assertion failed')};
 function fixture(overrides={}){
  const listeners=new Map(),win=new Map(),states=[],sent=[],transcripts=[],started=[],timers=new Map(),track={stopped:false,stop(){this.stopped=true}};let n=0;
  const ws={readyState:1,bufferedAmount:0,send:s=>sent.push(JSON.parse(s)),close(){this.readyState=3},addEventListener:(e,h)=>listeners.set(e,h)};
  const capture={port:{postMessage(){}},connect(){},disconnect(){}};
  const ctx={currentTime:0,destination:{},resume:async()=>{},close:async()=>{},audioWorklet:{addModule:async()=>{}},createMediaStreamSource:()=>({connect(){},disconnect(){}}),createBuffer:()=>({copyToChannel(){}}),createBufferSource:()=>({connect(){},disconnect(){},stop(){},start(t){started.push(t)}})};
  const ctl=create({media:async()=>({getTracks:()=>[track]}),context:()=>ctx,worklet:()=>capture,socket:()=>ws,encode:()=> 'AAAA',decode:()=>new Float32Array(480),onState:s=>states.push(s),onTranscript:x=>transcripts.push(x),events:{addEventListener:(e,h)=>win.set(e,h),removeEventListener:e=>win.delete(e)},schedule:f=>{timers.set(++n,f);return n},cancel:i=>timers.delete(i),...overrides});
  const msg=e=>listeners.get('message')?.({data:JSON.stringify(e)});
  return{ctl,ws,capture,states,sent,started,track,transcripts,msg,ready:()=>msg({type:'state',state:'active'}),offline:()=>win.get('offline')?.(),tick:()=>{const [k,f]=timers.entries().next().value;timers.delete(k);f()},mic:()=>capture.port.onmessage({data:new Uint8Array(960)})};
 }
 const cases=[
  async()=>{const f=fixture();await f.ctl.start();f.mic();assert(!f.sent.length);f.ready();f.mic();assert(f.sent[0].type==='audio');f.ctl.abort()},
  async()=>{const f=fixture();await f.ctl.start();f.ready();f.msg({type:'audio',delta:'AAAA'});f.msg({type:'audio',delta:'AAAA'});assert(f.started.length===2&&f.started[1]>f.started[0]);f.ctl.abort()},
  async()=>{const f=fixture();await f.ctl.start();f.ready();f.msg({type:'session.input_transcript.delta',delta:'Halo'});assert(f.transcripts[0].role==='user');f.ctl.abort()},
  async()=>{const f=fixture();await f.ctl.start();f.ready();f.ctl.stop();assert(f.track.stopped&&f.sent.at(-1).type==='stop');f.msg({type:'final',confirmed:true});assert(f.states.at(-1)==='closed')},
  async()=>{const f=fixture();await f.ctl.start();f.ready();f.offline();assert(f.track.stopped&&f.states.at(-1)==='unconfirmed')},
  async()=>{const f=fixture();await f.ctl.start();f.ready();f.ws.bufferedAmount=100000;f.mic();assert(f.sent.at(-1).type==='stop'&&f.track.stopped);f.ctl.abort()},
  async()=>{const f=fixture();await f.ctl.start();f.tick();assert(f.track.stopped&&f.states.at(-1)==='timeout')},
  async()=>{const f=fixture();await f.ctl.start();f.ready();f.ctl.stop();f.tick();assert(f.states.at(-1)==='unconfirmed')},
  async()=>{const f=fixture({media:async()=>{throw Object.assign(Error(),{name:'NotAllowedError'})}});assert(!(await f.ctl.start())&&f.states.at(-1)==='denied')},
  async()=>{const f=fixture();await f.ctl.start();f.ready();f.msg({type:'state',state:'closing'});assert(f.track.stopped);f.msg({type:'final',confirmed:false});assert(f.states.at(-1)==='unconfirmed')},
  async()=>{const f=fixture();await f.ctl.start();f.ready();f.msg({type:'final',confirmed:true});f.msg({type:'state',state:'active'});assert(f.states.at(-1)==='closed')},
 ];
 for(const c of cases)await c();return{passed:cases.length,total:cases.length};
}
console.log(await runBrowserTests(createPrimaryBrowser));
