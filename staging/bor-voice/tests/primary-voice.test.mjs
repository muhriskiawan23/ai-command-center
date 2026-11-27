import {createPrimaryVoice} from '../primary-voice.mjs';
function runPrimaryVoiceTests(create){
  let passed=0;
  const assert=(v)=>{if(!v)throw Error('assertion failed')};
  function fixture(){
    const listeners={},sent=[],final=[],audio=[],states=[],timers=new Map();let t=0;
    const socket={send:s=>sent.push(JSON.parse(s)),close(){},addEventListener:(e,f)=>listeners[e]=f,removeEventListener:(e,f)=>{if(listeners[e]===f)delete listeners[e]}};
    const voice=create({socket,onAudio:v=>audio.push(v),onFinal:v=>final.push(v),onState:v=>states.push(v),schedule:f=>{timers.set(++t,f);return t},cancel:i=>timers.delete(i)});
    const msg=e=>listeners.message?.({data:JSON.stringify(e)});
    const ready=()=>msg({type:'session.started',session:{id:'live_test',model:'gpt-live-1.1'}});
    const closed=(seconds,id='live_test')=>msg({type:'session.closed',session:{id,model:'gpt-live-1.1'},usage:{seconds}});
    const tick=()=>{const [i,f]=timers.entries().next().value;timers.delete(i);f()};
    return {voice,sent,final,audio,states,ready,closed,msg,tick,disconnect:()=>listeners.close?.()};
  }
  const cases=[
    ()=>{const f=fixture();assert(f.sent[0].session.model==='gpt-live-1.1'&&!f.voice.appendAudio('AAAA'));},
    ()=>{const f=fixture();f.ready();assert(f.voice.appendAudio('AAAA')&&f.sent[1].type==='session.input_audio.append');},
    ()=>{const f=fixture();f.ready();assert(!f.voice.appendAudio('bad!')&&!f.voice.appendAudio('A'.repeat(16388)));},
    ()=>{const f=fixture();f.ready();f.msg({type:'session.output_audio.delta',delta:'AAAA'});assert(f.audio[0]==='AAAA');},
    ()=>{const f=fixture();f.ready();f.tick();assert(f.sent.at(-1).type==='session.close'&&!f.voice.appendAudio('AAAA'));},
    ()=>{const f=fixture();f.ready();f.voice.close();f.closed(10);assert(f.final.length===1&&f.final[0].confirmed&&f.final[0].usage.seconds===10);},
    ()=>{const f=fixture();f.ready();f.voice.close();f.tick();assert(f.final[0].confirmed===false&&f.final[0].usage===null);},
    ()=>{const f=fixture();f.ready();f.disconnect();assert(!f.final[0].confirmed);},
    ()=>{const f=fixture();f.ready();f.closed(10,'live_other');assert(!f.final[0].confirmed);},
    ()=>{const f=fixture();f.ready();f.msg({type:'session.usage.updated',usage:{seconds:8}});f.closed(7);assert(!f.final[0].confirmed&&f.final[0].latestSeconds===8);},
    ()=>{const f=fixture();f.ready();f.voice.close();f.voice.close();assert(f.sent.filter(e=>e.type==='session.close').length===1);},
    ()=>{const f=fixture();f.ready();f.closed(12);f.disconnect();assert(f.final.length===1);}
  ];
  for(const c of cases){c();passed++}
  return {passed,total:cases.length};
}
console.log(runPrimaryVoiceTests(createPrimaryVoice));
