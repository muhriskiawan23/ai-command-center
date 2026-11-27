(function(root){
  'use strict';
  const player=root.BORVoicePlayback.createPlayback({synth:root.speechSynthesis,Utterance:root.SpeechSynthesisUtterance});
  function addReadButton(actions,rendered){
    const button=document.createElement('button');button.type='button';button.className='message-action voice-read-action';
    button.textContent='Bacakan';button.setAttribute('aria-pressed','false');
    button.title='Bacakan dengan suara lokal perangkat';
    button.addEventListener('click',()=>{
      const lang=(document.documentElement.lang||'id').toLowerCase().startsWith('en')?'en-US':'id-ID';
      player.toggle({key:button,text:rendered.innerText,language:lang,notify(state){
        const playing=state==='playing';button.textContent=playing?'Hentikan suara':'Bacakan';button.setAttribute('aria-pressed',String(playing));
        if(state==='no-local-voice')root.BORVoiceChat.notice('Suara lokal untuk bahasa antarmuka belum tersedia.');
        if(state==='unsupported')root.BORVoiceChat.notice('Pembacaan suara tidak didukung browser ini.');
        if(state==='invalid-text')root.BORVoiceChat.notice('Jawaban kosong atau terlalu panjang untuk dibacakan.');
        if(state==='error')root.BORVoiceChat.notice('Pembacaan gagal. Coba lagi.');
      }});
    });
    actions.append(button);
  }
  root.BORVoiceChat={addReadButton,stop:player.stop,notice:()=>{}};
  root.addEventListener('pagehide',player.stop);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)player.stop()});
})(globalThis);
