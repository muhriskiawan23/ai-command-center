(() => {
  "use strict";
  const script = document.currentScript;
  const apiKey = script?.dataset.apiKey || "";
  const apiUrl = script?.dataset.apiUrl || new URL("/api/public/chat", script.src || location.href).href;
  if (!apiKey || !/^https:\/\//i.test(apiUrl)) return;
  const host = document.createElement("div");
  host.className = "bor-ai-widget";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host{all:initial;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#171717}
      .launcher{position:fixed;right:20px;bottom:20px;z-index:2147483000;border:0;border-radius:999px;padding:13px 18px;background:#171717;color:white;font:600 14px system-ui;cursor:pointer;box-shadow:0 4px 18px #0003}
      .panel{position:fixed;right:20px;bottom:78px;z-index:2147483000;width:min(360px,calc(100vw - 32px));height:min(520px,calc(100dvh - 110px));display:none;flex-direction:column;border:1px solid #ddd;border-radius:16px;background:#fff;box-shadow:0 8px 35px #0003;overflow:hidden}
      .panel[open]{display:flex}.head{padding:14px 16px;background:#171717;color:#fff;font-weight:650;display:flex;justify-content:space-between}.close{border:0;background:none;color:white;font-size:20px;cursor:pointer}
      .messages{padding:14px;flex:1;overflow:auto;display:flex;flex-direction:column;gap:10px}.bubble{max-width:90%;padding:10px 12px;border-radius:12px;background:#f1f1f1;white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 system-ui}.user{align-self:flex-end;background:#e7efff}.assistant{align-self:flex-start}
      form{display:flex;gap:8px;padding:12px;border-top:1px solid #eee}textarea{min-width:0;flex:1;resize:none;border:1px solid #ccc;border-radius:9px;padding:9px;font:13px system-ui}button.send{border:0;border-radius:9px;background:#171717;color:#fff;padding:0 13px;cursor:pointer}button:disabled{opacity:.5}
      .status{padding:0 12px 8px;color:#666;font:11px system-ui}
    </style>
    <button class="launcher" type="button" aria-expanded="false">Chat dengan BOR AI</button>
    <section class="panel" aria-label="Chat BOR AI">
      <header class="head"><span>BOR AI</span><button class="close" type="button" aria-label="Tutup">×</button></header>
      <div class="messages" aria-live="polite"><div class="bubble assistant">Halo! Ada yang bisa saya bantu?</div></div>
      <div class="status" role="status">AI dapat membuat kesalahan. Periksa informasi penting.</div>
      <form><textarea rows="2" maxlength="12000" placeholder="Tulis pesan..." aria-label="Pesan"></textarea><button class="send" type="submit">Kirim</button></form>
    </section>`;
  const launcher=shadow.querySelector(".launcher"),panel=shadow.querySelector(".panel"),close=shadow.querySelector(".close"),messages=shadow.querySelector(".messages"),form=shadow.querySelector("form"),input=shadow.querySelector("textarea"),send=shadow.querySelector(".send"),status=shadow.querySelector(".status");
  const add=(text,role)=>{const el=document.createElement("div");el.className="bubble "+role;el.textContent=text;messages.append(el);messages.scrollTop=messages.scrollHeight;};
  launcher.addEventListener("click",()=>{panel.toggleAttribute("open");launcher.setAttribute("aria-expanded",String(panel.hasAttribute("open")));if(panel.hasAttribute("open"))input.focus();});
  close.addEventListener("click",()=>{panel.removeAttribute("open");launcher.setAttribute("aria-expanded","false");launcher.focus();});
  form.addEventListener("submit",async event=>{
    event.preventDefault();const message=input.value.trim();if(!message||send.disabled)return;
    add(message,"user");input.value="";send.disabled=true;status.textContent="BOR AI sedang berpikir…";
    try{
      const response=await fetch(apiUrl,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+apiKey},body:JSON.stringify({message})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||"Permintaan gagal.");
      add(data.response||"Tidak ada jawaban.","assistant");status.textContent="Kuota hari ini: "+data.usage.remaining+" dari "+data.usage.limit+" tersisa.";
    }catch(error){add(error.message||"Koneksi gagal.","assistant");status.textContent="Periksa koneksi atau konfigurasi API key.";}
    finally{send.disabled=false;input.focus();}
  });
  document.body.append(host);
})();