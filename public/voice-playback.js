/* BOR AI: explicit, device-local read-aloud; no provider/network fallback. */
(function(root){
  'use strict';
  function createPlayback({synth, Utterance, maxChars=20000}) {
    let active=null;
    const notify=(job,state)=>{try{job.notify(state)}catch{}};
    function stop(){const job=active;active=null;if(!job)return;try{synth.cancel()}catch{}notify(job,'idle');}
    function toggle({key,text,language,notify:callback}){
      if(active?.key===key){stop();return 'idle'}
      stop();
      const clean=String(text??'').trim();
      const job={key,notify:typeof callback==='function'?callback:()=>{}};
      if(!clean||clean.length>maxChars){notify(job,'invalid-text');return 'invalid-text'}
      if(!synth||typeof Utterance!=='function'){notify(job,'unsupported');return 'unsupported'}
      const lang=String(language||'id-ID').toLowerCase().split('-')[0];
      let voice;
      try{voice=synth.getVoices().find(v=>v.localService===true&&String(v.lang).toLowerCase().split('-')[0]===lang)}catch{}
      if(!voice){notify(job,'no-local-voice');return 'no-local-voice'}
      try{
        const u=new Utterance(clean);u.voice=voice;u.lang=voice.lang;job.utterance=u;active=job;
        const finish=state=>{if(active!==job)return;active=null;notify(job,state)};
        u.onend=()=>finish('idle');u.onerror=()=>finish('error');
        notify(job,'playing');synth.speak(u);return active===job?'playing':'idle';
      }catch{if(active===job)active=null;notify(job,'error');return 'error'}
    }
    return {toggle,stop};
  }
  root.BORVoicePlayback={createPlayback};
})(globalThis);
