"use strict";
/*
 * BOR AI — web client (vanilla JS, tanpa build step).
 *
 * Bagian: 1) helper  2) state aplikasi  3) Google Sign-In  4) router + History API
 *         5) drawer (mobile)  6) chat  7) boot
 *
 * Aturan navigasi Back (prioritas): (1) tutup dialog teratas — belum ada dialog kustom,
 * (2) tutup drawer, (3) rute in-app sebelumnya, (4) perilaku browser biasa.
 * Catatan: browser tidak memberi akses ke tombol Back native Android; yang tersedia hanya
 * History API, dan itulah yang dipakai di sini.
 */
const API="";
const $=id=>document.getElementById(id);

/* ---------- 1. Helper (fungsi markdown/render pesan dipertahankan dari versi sebelumnya) ---------- */
function id(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function toast(message){const el=$("toast");el.textContent=message;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,2200)}
function escapeHTML(s){return String(s).replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function markdown(input) {
  return globalThis.BORMarkdown ? globalThis.BORMarkdown.render(input) : "<p>" + escapeHTML(input || "") + "</p>";
}


  function appendMessage(role,content,scroll=true,controls={}) {
    const row=document.createElement("article");row.className="message "+role;
    const avatar=document.createElement("div");avatar.className="avatar";avatar.textContent=role==="assistant"?"✳":"";
    const body=document.createElement("div");body.className="message-body";
    const fileMessage=role==="user"?unpackAttachmentMessage(content):{text:content,attachment:null};
    const visibleContent=fileMessage.text;
    if(fileMessage.attachment){row.classList.add("message-with-file");body.append(buildSentFileCard(fileMessage.attachment,controls.previewUrl));}
    const rendered=document.createElement("div");rendered.className="message-text";rendered.innerHTML=markdown(visibleContent);body.append(rendered);
    const actions=document.createElement("div");actions.className="message-actions";
    const copyBtn=document.createElement("button");copyBtn.type="button";copyBtn.className="message-action";copyBtn.textContent="Salin";copyBtn.addEventListener("click",()=>copyText(visibleContent));
    const markdownBtn=document.createElement("button");markdownBtn.type="button";markdownBtn.className="message-action";markdownBtn.textContent="Markdown";markdownBtn.addEventListener("click",()=>downloadMarkdown(visibleContent,role));
    const plainBtn=document.createElement("button");plainBtn.type="button";plainBtn.className="message-action";plainBtn.textContent="Teks";plainBtn.addEventListener("click",()=>downloadText(visibleContent,role));const printBtn=document.createElement("button");printBtn.type="button";printBtn.className="message-action print-message";printBtn.textContent="PDF / Cetak";printBtn.addEventListener("click",()=>printMessage(visibleContent,role));actions.append(copyBtn,markdownBtn,plainBtn,printBtn);
    if(role==="assistant"){
      const checklistBtn=document.createElement("button");checklistBtn.type="button";checklistBtn.className="message-action checklist-action";checklistBtn.textContent="Checklist";
      checklistBtn.addEventListener("click",()=>showChecklistExport(content,actions));actions.append(checklistBtn);
    }
    if(controls.edit&&!fileMessage.attachment){const editBtn=document.createElement("button");editBtn.type="button";editBtn.className="message-action edit-message";editBtn.textContent="Edit & kirim";editBtn.addEventListener("click",()=>replaceLastTurn("edit",visibleContent));actions.append(editBtn)}
    if(controls.regenerate){const regenBtn=document.createElement("button");regenBtn.type="button";regenBtn.className="message-action regenerate-message";regenBtn.textContent="Buat ulang";regenBtn.addEventListener("click",()=>replaceLastTurn("regenerate",content));actions.append(regenBtn)}
    body.append(actions);
    if(role==="assistant"&&state===AppState.AUTH&&controls.responseId&&controls.conversationId){
      const feedback=document.createElement("div");feedback.className="answer-feedback";
      const label=document.createElement("span");label.className="feedback-label";label.textContent="Apakah jawaban ini membantu?";
      const helpful=document.createElement("button");helpful.type="button";helpful.className="feedback-vote";helpful.textContent="👍";helpful.setAttribute("aria-label","Jawaban membantu");helpful.title="Membantu";
      const unhelpful=document.createElement("button");unhelpful.type="button";unhelpful.className="feedback-vote";unhelpful.textContent="👎";unhelpful.setAttribute("aria-label","Jawaban tidak membantu");unhelpful.title="Tidak membantu";
      const status=document.createElement("span");status.className="feedback-status";status.setAttribute("role","status");
      const panel=document.createElement("div");panel.className="feedback-panel";panel.hidden=true;
      const reason=document.createElement("textarea");reason.maxLength=500;reason.rows=2;reason.placeholder="Apa yang perlu diperbaiki? (opsional)";reason.setAttribute("aria-label","Alasan feedback opsional");
      const send=document.createElement("button");send.type="button";send.className="feedback-submit";send.textContent="Kirim feedback";
      const existing=controls.feedback||null;
      if(existing){helpful.setAttribute("aria-pressed",String(existing.rating==="helpful"));unhelpful.setAttribute("aria-pressed",String(existing.rating==="not_helpful"));status.textContent="Feedback tersimpan";if(existing.rating==="not_helpful"){panel.hidden=false;reason.value=existing.reason||"";send.textContent="Perbarui feedback"}}
      const submitFeedback=async(rating,reasonText="")=>{
        helpful.disabled=true;unhelpful.disabled=true;send.disabled=true;status.textContent="Mengirim…";
        try{
          const saved=await postJson("/api/feedback",{conversationId:controls.conversationId,responseId:controls.responseId,rating,reason:reasonText});
          helpful.setAttribute("aria-pressed",String(saved.rating==="helpful"));unhelpful.setAttribute("aria-pressed",String(saved.rating==="not_helpful"));
          status.textContent="Feedback tersimpan";panel.hidden=saved.rating!=="not_helpful";
        }catch(error){status.textContent=error.message||"Feedback gagal disimpan."}
        finally{helpful.disabled=false;unhelpful.disabled=false;send.disabled=false}
      };
      helpful.addEventListener("click",()=>submitFeedback("helpful"));
      unhelpful.addEventListener("click",()=>{panel.hidden=false;reason.focus()});
      send.addEventListener("click",()=>submitFeedback("not_helpful",reason.value.trim()));
      panel.append(reason,send);feedback.append(label,helpful,unhelpful,status,panel);body.append(feedback);
    }
    row.append(avatar,body);messagesEl.append(row);if(scroll)conversation.scrollTop=conversation.scrollHeight;
  }
function showTyping(){const row=document.createElement("article");row.className="message assistant";row.id="typing";row.innerHTML='<div class="avatar">✳</div><div class="message-body"><span class="typing"><span></span><span></span><span></span></span></div>' ;messagesEl.append(row);conversation.scrollTop=conversation.scrollHeight}
function renderWorkflow(steps){const items=$("workflowItems");items.replaceChildren();if(!Array.isArray(steps)||!steps.length){$("workflow").hidden=true;return}$("workflow").hidden=false;for(const step of steps){const block=document.createElement("div");block.className="workflow-step";const label=document.createElement("strong");label.textContent=step.agent||"Langkah";const status=document.createElement("span");status.textContent=step.status||"completed";status.className="workflow-status";block.append(label,status);const output=document.createElement("pre");output.textContent=step.output||"";block.append(output);items.append(block)}}
/* Textarea tumbuh mengikuti isi (scrollHeight) sampai max-height dari CSS, lalu berhenti dan scroll di dalam. */
function resizePrompt(){
  const viewportHeight=Math.min(window.innerHeight,window.visualViewport?.height||window.innerHeight);
  promptEl.style.height="auto";
  const max=Math.min(220,viewportHeight*0.4);
  const needed=promptEl.scrollHeight;
  promptEl.style.height=Math.min(needed,max)+"px";
  promptEl.style.overflowY=needed>max?"auto":"hidden";
}
async function health(){try{const r=await fetch(API+"/api/health");if(!r.ok)throw Error();const d=await r.json();$("healthDot").className="dot "+(d.ok?"ok":"bad");$("healthText").textContent=d.ok?"Layanan aktif":"Layanan tidak aktif";$("healthDot").title=d.ok?"Layanan aktif":"Layanan gagal";}catch{const dot=$("healthDot");dot.className="dot bad";dot.title="Layanan tidak dapat dicek";$("healthText").textContent="Status tidak siap";}}

const CHAT_TIMEOUT_MS=150000; /* alur multi-agent bisa beberapa panggilan model berurutan; lewat ini dianggap macet */
let activeChatController=null;
let pendingRetryRequest=null;
let routingImageRequest=false;
async function api(path,opts={}){
  const {timeoutMs,onSearch,...fetchOpts}=opts;let res,data=null,status,timer,timedOut=false;
  const externalSignal=fetchOpts.signal;
  const ctrl=timeoutMs?new AbortController():null;
  if(ctrl){fetchOpts.signal=externalSignal?AbortSignal.any([externalSignal,ctrl.signal]):ctrl.signal;timer=setTimeout(()=>{timedOut=true;ctrl.abort()},timeoutMs)}
  try{
    res=await fetch(API+path,{credentials:"same-origin",...fetchOpts});
    status=res.status;
    if(onSearch&&res.headers.get("Content-Type")?.startsWith("application/x-ndjson")){
      const result=await readChatProgress(res.body,onSearch);
      ({status,data}=result);
    }else{try{data=await res.json()}catch(error){if(fetchOpts.signal?.aborted)throw error;}}
  }
  catch(error){
    if(externalSignal?.aborted)throw Object.assign(new Error("Generasi dihentikan."),{name:"AbortError",cancelled:true,status:0});
    throw Object.assign(new Error(timedOut?"Server terlalu lama merespons (lebih dari "+Math.round(timeoutMs/1000)+" detik). Coba lagi.":"Tidak dapat terhubung ke server. Periksa koneksi Anda."),{status:0});
  }finally{clearTimeout(timer)}
  if(status<200||status>=300){
    const err=new Error((data&&data.error)||"HTTP "+status);err.status=status;err.code=data&&data.code;err.data=data;
    if(status===401&&state===AppState.AUTH)expireSession();
    throw err;
  }
  return data||{};
}
async function readChatProgress(body,onSearch){
  const reader=body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer="";
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)throw new Error("Incomplete chat response");
      buffer+=value;
      if(buffer.length>512000)throw new Error("Chat response too large");
      let end;
      while((end=buffer.indexOf("\n"))>=0){
        const event=JSON.parse(buffer.slice(0,end));
        buffer=buffer.slice(end+1);
        if(event.type==="result")return event;
        if(event.type==="searching")onSearch(event.provider);
      }
    }
  }finally{reader.cancel().catch(()=>{});reader.releaseLock();}
}
const postJson=(path,body,timeoutMs,signal,vision=false,onSearch)=>api(path,{method:"POST",headers:{"Content-Type":"application/json",...(vision?{"X-BOR-Vision":"1"}:{}),...(onSearch?{"X-BOR-Chat-Progress":"1"}:{})},body:JSON.stringify(body),timeoutMs,signal,onSearch});
function copyText(value){
  const text=String(value||"").trim();
  if(!text){toast("Tidak ada konten untuk disalin.");return;}
  navigator.clipboard?.writeText(text).then(()=>toast("Konten tersalin."),()=>toast("Clipboard tidak tersedia."));
}
function downloadText(value, role="assistant"){
  const text=String(value||"").trim();
  if(!text){toast("Tidak ada konten untuk diunduh.");return;}
  const blob=new Blob([text],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=(role==="assistant"?"bor-ai-response":"bor-ai-message")+".txt";a.click();
  URL.revokeObjectURL(url);
  toast("Teks berhasil diunduh.");
}
function downloadMarkdown(value, role="assistant"){
  const text=String(value||"").trim();
  if(!text){toast("Tidak ada konten untuk diunduh.");return;}
  const blob=new Blob([text],{type:"text/markdown;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=(role==="assistant"?"bor-ai-response":"bor-ai-message")+".md";a.click();
  URL.revokeObjectURL(url);
  toast("Markdown berhasil diunduh.");
}
function openPrintDocument(title, sections) {
  const popup=window.open("", "_blank");
  const safeTitle=escapeHTML(String(title||"Dokumen BOR AI").replace(/[\x00-\x1f\x7f]/g," ").trim().slice(0,100)||"Dokumen BOR AI");
  const body=sections.map(section=>'<section class="print-section"><h2>'+escapeHTML(section.heading)+'</h2><div class="print-content">'+markdown(section.content)+'</div></section>').join("");
  const html='<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+safeTitle+'</title><style>*{box-sizing:border-box}body{margin:0;padding:32px;color:#171717;background:#fff;font:14px/1.65 Arial,Helvetica,sans-serif}.print-header{padding-bottom:18px;margin-bottom:24px;border-bottom:2px solid #222}.print-brand{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#555;font-weight:700}.print-header h1{font-size:24px;line-height:1.25;margin:8px 0}.print-meta{font-size:11px;color:#666}.print-section{margin:0 0 26px;break-inside:avoid}.print-section h2{font-size:16px;margin:0 0 9px;padding-bottom:5px;border-bottom:1px solid #ddd}.print-content{overflow-wrap:anywhere}.print-content h1,.print-content h2,.print-content h3{line-height:1.3;margin:16px 0 7px}.print-content p{margin:7px 0}.print-content ul,.print-content ol{padding-left:22px}.print-content blockquote{margin:10px 0;padding:7px 12px;border-left:3px solid #aaa;color:#444}.print-content pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:10px;background:#f2f2f2;border:1px solid #ddd;border-radius:5px}.print-content code{font-family:Consolas,monospace}.print-footer{margin-top:32px;padding-top:10px;border-top:1px solid #ddd;font-size:10px;color:#666}@page{size:auto;margin:16mm}@media print{body{padding:0}.print-section{break-inside:auto}.print-content pre,.print-content blockquote{break-inside:avoid}}@media screen{body{max-width:850px;margin:24px auto;padding:28px;box-shadow:0 2px 18px #0002}.print-hint{display:block;margin-top:12px;color:#666;font-size:11px}}@media print{.print-hint{display:none}}</style></head><body><header class="print-header"><div class="print-brand">BOR AI</div><h1>'+safeTitle+'</h1><div class="print-meta">Dibuat '+escapeHTML(new Date().toLocaleString())+'</div></header>'+body+'<footer class="print-footer">Dokumen dibuat secara lokal oleh BOR AI. Periksa kembali informasi penting sebelum dibagikan.</footer><div class="print-hint">Gunakan opsi printer tujuan “Save as PDF” untuk menyimpan dokumen sebagai PDF.</div></body></html>';
  try{popup.document.open();popup.document.write(html);popup.document.close();popup.focus();setTimeout(()=>{try{popup.print()}catch{}},350);return true;}
  catch{popup.close();toast("Dokumen tidak dapat disiapkan untuk dicetak.");return false;}
}
function printMessage(content, role="assistant") {
  if(!String(content||"").trim()){toast("Tidak ada konten untuk dicetak.");return;}
  openPrintDocument(role==="assistant"?"Jawaban BOR AI":"Pesan pengguna BOR AI",[{heading:role==="assistant"?"Jawaban BOR AI":"Pesan pengguna",content:String(content)}]);
}
function printConversation() {
  if(busy||loadingChat)return;
  const chat=conversations.find(item=>item.id===activeId);
  if(!chat||!Array.isArray(chat.messages)||!chat.messages.length){toast("Belum ada pesan untuk dicetak.");return;}
  const title=String(chat.title||"Percakapan BOR AI").replace(/[\x00-\x1f\x7f]/g," ").replace(/\s+/g," ").trim().slice(0,72)||"Percakapan BOR AI";
  const sections=chat.messages.filter(message=>message&&["user","assistant"].includes(message.role)&&typeof message.content==="string").map(message=>({heading:message.role==="user"?"Pengguna":"BOR AI",content:message.content}));
  if(chat.truncated)sections.unshift({heading:"Catatan kelengkapan",content:"Percakapan melebihi batas tampilan 500 pesan. Dokumen ini hanya memuat 500 pesan terakhir yang tersedia."});
  openPrintDocument(title,sections);
}
function showChecklistExport(content, actions) {
  const result=window.BORChecklist?.convertToChecklist(content);
  if(!result?.ok){toast("Tidak ditemukan item daftar untuk dijadikan checklist.");return;}
  const existing=actions.querySelector(".checklist-export");
  if(existing){existing.remove();return;}
  const panel=document.createElement("div");panel.className="checklist-export";
  const preview=document.createElement("pre");preview.className="checklist-preview";preview.textContent=result.markdown;
  const controls=document.createElement("div");controls.className="checklist-export-actions";
  const copy=document.createElement("button");copy.type="button";copy.className="message-action";copy.textContent="Salin checklist";copy.addEventListener("click",()=>copyText(result.markdown));
  const download=document.createElement("button");download.type="button";download.className="message-action";download.textContent="Unduh .md";download.addEventListener("click",()=>{
    const blob=new Blob([result.markdown],{type:"text/markdown;charset=utf-8"});
    const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="bor-ai-checklist.md";a.click();URL.revokeObjectURL(url);toast("Checklist berhasil diunduh.");
  });
  controls.append(copy,download);panel.append(preview,controls);actions.append(panel);
}
function exportConversationFile(){
  if(busy||loadingChat)return;
  const chat=conversations.find(item=>item.id===activeId);
  if(!chat||!Array.isArray(chat.messages)||!chat.messages.length){toast("Belum ada pesan untuk diekspor.");return;}
  const title=String(chat.title||"Percakapan BOR AI").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,72)||"Percakapan BOR AI";
  const lines=["BOR AI — Ekspor Percakapan","Judul: "+title,"Diekspor: "+new Date().toLocaleString(),"","CATATAN PRIVASI: Ekspor ini dapat berisi informasi pribadi atau sensitif. Simpan dengan aman dan bagikan hanya jika Anda memang menghendakinya."];
  if(chat.truncated)lines.push("CATATAN KELENGKAPAN: Percakapan ini melebihi batas tampilan 500 pesan. File ini hanya berisi 500 pesan terakhir yang tersedia.");
  lines.push("","=".repeat(64));
  for(const message of chat.messages){
    if(!message||!["user","assistant"].includes(message.role)||typeof message.content!=="string")continue;
    lines.push("",message.role==="user"?"PENGGUNA":"BOR AI","-".repeat(32),message.content);
  }
  const blob=new Blob([lines.join("\n")],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  const safeName=title.toLocaleLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"percakapan";
  a.href=url;a.download="bor-ai-"+safeName+".txt";a.click();
  URL.revokeObjectURL(url);
  toast("Percakapan berhasil diekspor.");
}

/* ---------- 2. State aplikasi ---------- */
const AppState={INIT:"initializing",UNAUTH:"unauthenticated",GUEST:"guest",AUTH:"authenticated",EXPIRED:"session-expired",ERROR:"error"};
const promptEl=$("prompt"),messagesEl=$("messages"),welcomeEl=$("welcome"),conversation=$("conversation");
const sidebar=$("sidebar"),backdrop=$("backdrop"),menuBtn=$("menuBtn"),workspace=$("workspace");
let state=AppState.INIT,conversations=[],activeId=null,busy=false,currentUser=null,historyQuery="",archivedView=false,activePdf=null,activeCsv=null,attachmentPending=null,attachmentSequence=0,attachmentThumbnailUrl=null,sentImageUrls=[];
let historyCursor=null,historyHasMore=false,historyLoadingMore=false,historyRequestSeq=0;
/* navSeq: setiap navigasi chat menaikkan penghitung ini; pemuatan yang tertimpa navigasi lebih baru dibatalkan. */
let navSeq=0,loadingChat=false;
function lockComposer(){const lock=busy||loadingChat;const send=$("send"),stop=$("stopGeneration");send.disabled=lock||Boolean(attachmentPending);send.hidden=busy;stop.hidden=!busy;stop.disabled=!busy;promptEl.readOnly=lock;$("exportConversation").disabled=lock;$("printConversation").disabled=lock;$("attachPdf").disabled=lock;$("attachCsv").disabled=lock;}

/* Yang disimpan di sessionStorage HANYA penanda "sudah memilih Guest" (agar refresh tidak kembali ke Welcome).
   Isi chat guest tidak pernah ditulis ke storage mana pun. */
const GUEST_FLAG="borai.guest";
function readGuestFlag(){try{return sessionStorage.getItem(GUEST_FLAG)==="1"}catch{return false}}
function writeGuestFlag(on){try{if(on)sessionStorage.setItem(GUEST_FLAG,"1");else sessionStorage.removeItem(GUEST_FLAG)}catch{}}

function inChatView(){return state===AppState.GUEST||state===AppState.AUTH}
function setState(next,notice=""){
  state=next;document.body.dataset.state=next;
  $("boot").hidden=next!==AppState.INIT;
  $("gate").hidden=!(next===AppState.UNAUTH||next===AppState.EXPIRED||next===AppState.ERROR);
  $("app").hidden=!inChatView();
  const n=$("gateNotice");n.textContent=notice;n.hidden=!notice;
  $("gateRetry").hidden=next!==AppState.ERROR;
  if(!inChatView()){closeMemoryDom(false);closeDrawerDom(false)}
  syncInert();renderAuth();
}
function resetChatView(){
  navSeq++;loadingChat=false;attachmentSequence++;releaseUnsentThumbnail();attachmentPending=null;activePdf=null;activeCsv=null;renderPdfAttachment();renderCsvAttachment();lockComposer();
  activeId=null;$("exportConversation").hidden=true;$("printConversation").hidden=true;messagesEl.replaceChildren();messagesEl.hidden=true;welcomeEl.hidden=false;
  $("workflow").hidden=true;promptEl.value="";resizePrompt();
}
function clearSessionData(){historyRequestSeq++;historyCursor=null;historyHasMore=false;historyLoadingMore=false;currentUser=null;conversations=[];resetChatView();renderHistory()}
function expireSession(){
  if(state!==AppState.AUTH)return;
  clearSessionData();writeGuestFlag(false);
  setState(AppState.EXPIRED,"Sesi Anda berakhir. Masuk lagi untuk mengakses riwayat chat, atau lanjutkan sebagai Guest.");
  loadGoogle(true);
}
async function verifySession(){try{const d=await api("/api/auth/me");if(!d.authenticated)expireSession()}catch{}}

function profileSettingsKey(){return "borai-profile:v1:" + String(currentUser?.id||currentUser?.email||"unknown");}
function readProfileSettings(){
  if(!currentUser)return {username:"",photo:""};
  try{
    const data=JSON.parse(localStorage.getItem(profileSettingsKey())||"null");
    if(!data||typeof data!=="object"||Array.isArray(data))return {username:"",photo:""};
    const photo=typeof data.photo==="string"&&data.photo.startsWith("data:image/jpeg;base64,")&&data.photo.length<350000?data.photo:"";
    return {username:typeof data.username==="string"?data.username.trim().slice(0,32):"",photo};
  }catch{return {username:"",photo:""};}
}
function writeProfileSettings(patch){
  const previous=readProfileSettings();
  const next={username:patch.username??previous.username,photo:patch.photo??previous.photo};
  localStorage.setItem(profileSettingsKey(),JSON.stringify(next));return next;
}
function profileDisplayName(){
  const settings=readProfileSettings();
  return settings.username||String(currentUser?.name||"Akun Google").trim()||"Akun Google";
}
function renderProfileEditor(){
  const settings=readProfileSettings(),displayName=profileDisplayName();
  $("accountTitle").textContent=displayName;$("accountName").textContent=displayName;
  $("profileUsername").value=settings.username||String(currentUser?.name||displayName);
  const image=settings.photo||currentUser?.picture||"",preview=$("profilePhotoPreview"),fallback=$("profilePhotoFallback");
  preview.hidden=!image;preview.removeAttribute("src");if(image)preview.src=image;
  fallback.hidden=Boolean(image);fallback.textContent=(displayName.trim().slice(0,1)||"A").toLocaleUpperCase();
  $("removeProfilePhoto").hidden=!settings.photo;
}
function renderAuth(){
  const logged=state===AppState.AUTH&&Boolean(currentUser);
  $("authTitle").textContent=logged?"Masuk sebagai":"Guest Mode";
  $("authDescription").textContent=logged?"Riwayat chat tersimpan di akun Google.":"Chat guest hanya ada di halaman ini dan hilang saat dimuat ulang. Masuk dengan Google untuk menyimpan riwayat permanen.";
  $("googleButton").hidden=logged;$("userProfile").hidden=!logged;$("signOut").hidden=!logged;
  $("googleSideStatus").hidden=logged||!$("googleSideStatus").textContent;$("userProfile").replaceChildren();
  if(logged){
    const settings=readProfileSettings(),displayName=settings.username||String(currentUser.name||"Akun Google").trim()||"Akun Google",picture=settings.photo||currentUser.picture||"";
    const wrap=document.createElement("div");wrap.className="auth-user";
    if(picture){const img=document.createElement("img");img.src=picture;img.alt="";wrap.append(img)}else{const avatar=document.createElement("span");avatar.className="account-initials";avatar.textContent=(displayName.trim().slice(0,1)||"A").toLocaleUpperCase();avatar.setAttribute("aria-hidden","true");wrap.append(avatar)}
    const info=document.createElement("div");info.className="auth-user-info";const name=document.createElement("strong");name.textContent=displayName;info.append(name);wrap.append(info);$("userProfile").append(wrap);
  }
  $("accountName").textContent=logged?profileDisplayName():"Akun Google";$("accountTitle").textContent=logged?profileDisplayName():"Profil pengguna";$("accountEmail").textContent=logged?String(currentUser.email||""):"";$("accountEmail").hidden=!logged||!currentUser.email;
  if(logged)renderProfileEditor();
  renderHistory();if(logged)refreshGitHubConnection();else resetGitHubConnection();
}

/* Account panel: a dedicated accessible page-like dialog, not extra sidebar settings. */
const accountDialog=$("accountDialog");
let returnToAccountOnChildClose=false;
function customizationKey(){return "borai-customization:v1:" + String(currentUser?.id||currentUser?.email||"guest");}
function readCustomization(){
  if(state!==AppState.AUTH||!currentUser)return null;
  try{
    const data=JSON.parse(localStorage.getItem(customizationKey())||"null");
    if(!data||typeof data!=="object")return null;
    return {
      nickname:typeof data.nickname==="string"?data.nickname.slice(0,60):"",
      tone:["natural","professional","direct"].includes(data.tone)?data.tone:"natural",
      length:["short","balanced","detailed"].includes(data.length)?data.length:"balanced"
    };
  }catch{return null;}
}
function accountView(page="home"){
  for(const [name,id] of [["home","accountHome"],["customize","accountCustomization"],["privacy","accountPrivacy"]])$(id).hidden=name!==page;
  if(page==="home")renderProfileEditor();
  $("accountBack").dataset.page=page;
  $("accountBack").setAttribute("aria-label",page==="home"?"Kembali ke chat":"Kembali ke profil");
  $("accountBack").focus();
}
function closeAccount(){
  if(!accountDialog.open)return;
  if(history.state?.overlay==="account")history.back();else accountDialog.close();
}
function profilePhotoDataUrl(file){
  return new Promise((resolve,reject)=>{
    if(!file||!["image/jpeg","image/png","image/webp"].includes(file.type)){reject(new Error("Foto harus JPG, PNG, atau WebP."));return;}
    if(file.size>10*1024*1024){reject(new Error("Ukuran foto maksimal 10 MB."));return;}
    createImageBitmap(file).then(bitmap=>{
      if(bitmap.width*bitmap.height>40000000){bitmap.close?.();reject(new Error("Foto profil gagal diproses."));return;}
      const side=Math.min(bitmap.width,bitmap.height),sx=(bitmap.width-side)/2,sy=(bitmap.height-side)/2;
      const canvas=document.createElement("canvas");canvas.width=256;canvas.height=256;
      const context=canvas.getContext("2d");
      if(!context){bitmap.close?.();reject(new Error("Foto profil gagal diproses."));return;}
      context.drawImage(bitmap,sx,sy,side,side,0,0,256,256);bitmap.close?.();
      try{resolve(canvas.toDataURL("image/jpeg",0.82));}catch{reject(new Error("Foto profil gagal diproses."));}
    }).catch(()=>reject(new Error("Foto profil gagal diproses.")));
  });
}
$("profilePhotoButton").addEventListener("click",()=>$("profilePhotoInput").click());
$("profilePhotoInput").addEventListener("change",async event=>{
  const file=event.target.files?.[0];event.target.value="";if(!file)return;
  try{const photo=await profilePhotoDataUrl(file);writeProfileSettings({photo});renderAuth();renderProfileEditor();toast("Foto profil berhasil diperbarui.");}
  catch(error){toast(error.message||"Foto profil gagal diproses.");}
});
$("profileForm").addEventListener("submit",event=>{
  event.preventDefault();const username=$("profileUsername").value.trim().replace(/\s+/g," ");
  if(!username||Array.from(username).length>32){toast("Username harus diisi (maksimal 32 karakter).");$("profileUsername").focus();return;}
  try{writeProfileSettings({username});renderAuth();renderProfileEditor();toast("Profil berhasil disimpan.");}
  catch{toast("Profil tidak dapat disimpan karena penyimpanan browser penuh.");}
});
$("removeProfilePhoto").addEventListener("click",()=>{
  try{writeProfileSettings({photo:""});renderAuth();renderProfileEditor();toast("Foto profil dihapus.");}
  catch{toast("Profil tidak dapat disimpan karena penyimpanan browser penuh.");}
});
$("userProfile").addEventListener("click",()=>{
  if(state!==AppState.AUTH||!currentUser)return;
  if(drawerOpen){
    // Replace the transient drawer entry; no async history.back race with the account overlay.
    closeDrawerDom(false);
    if(history.state?.overlay==="drawer")history.replaceState({borai:1,route:currentRoute()},"",location.href);
  }
  history.pushState({borai:1,overlay:"account",route:currentRoute()},"",location.href);
  if(!accountDialog.open)accountDialog.showModal();
  accountView("home");
});
$("accountClose").addEventListener("click",closeAccount);
$("accountBack").addEventListener("click",()=>{
  if($("accountBack").dataset.page==="home")closeAccount();else accountView("home");
});
accountDialog.addEventListener("click",event=>{
  // Opening an existing account feature closes only the visible dialog; keep the
  // account history entry so Back from Memory can return to this account view.
  if(event.target.closest("#openMemory,#about")){
    returnToAccountOnChildClose = Boolean(event.target.closest("#about"));
    accountDialog.close();
  }
},true);
accountDialog.addEventListener("cancel",event=>{event.preventDefault();closeAccount();});
accountDialog.addEventListener("close",()=>{
  if(!returnToAccountOnChildClose && $("userProfile").isConnected&&!$("userProfile").hidden)$("userProfile").focus();
});
$("openCustomization").addEventListener("click",()=>{
  const prefs=readCustomization()||{nickname:"",tone:"natural",length:"balanced"};
  $("customNickname").value=prefs.nickname;$("customTone").value=prefs.tone;$("customLength").value=prefs.length;
  $("customizeStatus").textContent="";accountView("customize");$("customNickname").focus();
});
$("customizeForm").addEventListener("submit",event=>{
  event.preventDefault();if(state!==AppState.AUTH||!currentUser)return;
  const value={nickname:$("customNickname").value.trim().slice(0,60),tone:$("customTone").value,length:$("customLength").value};
  if(!["natural","professional","direct"].includes(value.tone)||!["short","balanced","detailed"].includes(value.length))return;
  try{localStorage.setItem(customizationKey(),JSON.stringify(value));$("customizeStatus").textContent="Tersimpan di perangkat ini. Akan diterapkan pada jawaban berikutnya.";}
  catch{$("customizeStatus").textContent="Browser tidak mengizinkan penyimpanan preferensi.";}
});
$("openPrivacy").addEventListener("click",()=>accountView("privacy"));

let githubConnection=null;
let githubConnectionLoading=false;
let githubConnectionRequest=0;
function resetGitHubConnection(){
  githubConnection=null;githubConnectionLoading=false;githubConnectionRequest++;
  $("githubConnectionStatus").textContent="Sign in with Google to connect GitHub.";
  $("githubConnectionMessage").textContent=pluginText("Connect GitHub to browse repositories authorized for this app. GitHub actions in chat are not available yet.");
  $("githubStatusDot").className="github-status-dot";
  $("githubConnect").textContent="Connect GitHub";$("githubConnect").disabled=false;$("githubConnect").hidden=false;$("githubDisconnect").hidden=true;$("openGithubRepos").hidden=true;
}
async function refreshGitHubConnection(){
  if(state!==AppState.AUTH||!currentUser)return;
  const request=++githubConnectionRequest;githubConnectionLoading=true;
  $("githubConnectionStatus").textContent="Checking connection…";$("githubConnect").disabled=true;
  try{
    const data=await api("/api/github/connection");
    if(request!==githubConnectionRequest||state!==AppState.AUTH)return;
    githubConnection=Boolean(data.connected);
    $("githubConnectionStatus").textContent=githubConnection?(data.account?.login?"Connected · @"+data.account.login:"Connected"):"Not connected";
    $("githubConnectionMessage").textContent=pluginText(githubConnection
      ?githubChatToolsEnabled?"GitHub is connected. BOR AI can list repositories, review open issues, and read text files when you ask. It cannot make changes.":"GitHub is connected. You can browse repositories granted to the GitHub App. Chat actions are not available yet."
      :"Connect GitHub to browse repositories authorized for this app. GitHub actions in chat are not available yet.");
    $("githubStatusDot").className="github-status-dot "+(githubConnection?"is-connected":"");
    $("githubConnect").textContent=githubConnection?"Connect another account":"Connect GitHub";
    $("githubDisconnect").hidden=!githubConnection;
    $("openGithubRepos").hidden=!githubConnection;
    $("openGithubRepos").disabled=!githubConnection;
  }catch(error){
    if(request!==githubConnectionRequest)return;
    $("githubConnectionStatus").textContent="Connection status unavailable";
    $("githubConnectionMessage").textContent=error.message||"Could not check the GitHub connection.";
    $("githubStatusDot").className="github-status-dot has-error";
    $("openGithubRepos").hidden=true;
  }finally{if(request===githubConnectionRequest){githubConnectionLoading=false;$("githubConnect").disabled=false}}
}
function connectGitHub(){
  if(state!==AppState.AUTH||!currentUser){toast("Masuk dengan Google terlebih dahulu.");return}
  window.location.assign("/api/github/connect");
}
async function disconnectGitHub(){
  if(state!==AppState.AUTH||!currentUser||githubConnectionLoading)return;
  if(!window.confirm("Putuskan koneksi akun GitHub dari BOR AI?"))return;
  githubConnectionLoading=true;$("githubDisconnect").disabled=true;
  try{await api("/api/github/disconnect",{method:"POST"});toast("GitHub disconnected.");await refreshGitHubConnection()}
  catch(error){toast(error.message||"Gagal memutuskan koneksi GitHub.")}
  finally{githubConnectionLoading=false;$("githubDisconnect").disabled=false}
}

let githubRepositories=[];
let githubRepositoriesLoading=false;
let githubSelectedRepository=null;
function renderGitHubRepositories(){
  const list=$("githubReposList"),detail=$("githubRepoDetail");
  const query=$("githubRepoSearch").value.trim().toLowerCase();
  const visibility=$("githubRepoVisibility").value;
  const filtered=githubRepositories.filter(repo=>{
    const matchesQuery=[repo.fullName,repo.name,repo.description,repo.owner?.login].filter(Boolean).join(" ").toLowerCase().includes(query);
    const matchesVisibility=visibility==="all"||(visibility==="private"?repo.private:!repo.private);
    return matchesQuery&&matchesVisibility;
  }).sort((a,b)=>a.fullName.localeCompare(b.fullName));
  list.replaceChildren();
  if(!filtered.length){
    const empty=document.createElement("p");empty.className="github-repos-empty";empty.textContent=githubRepositories.length?"Tidak ada repository yang cocok dengan pencarian.":"Belum ada repository yang tersedia.";
    list.append(empty);
  }
  for(const repo of filtered){
    const button=document.createElement("button");button.type="button";button.className="github-repo-item"+(githubSelectedRepository?.id===repo.id?" is-active":"");
    const name=document.createElement("strong");name.textContent=repo.fullName;
    const meta=document.createElement("small");meta.textContent=(repo.private?"Private":"Public")+" · "+(repo.defaultBranch||"branch tidak diketahui");
    button.append(name,meta);button.addEventListener("click",()=>selectGitHubRepository(repo));list.append(button);
  }
  $("githubReposSummary").textContent=githubRepositories.length+" repository tersedia";
  if(githubSelectedRepository&&!filtered.some(repo=>repo.id===githubSelectedRepository.id))detail.replaceChildren(Object.assign(document.createElement("p"),{textContent:"Repository terpilih tidak cocok dengan filter."}));
}
function selectGitHubRepository(repo){
  githubSelectedRepository=repo;renderGitHubRepositories();
  const detail=$("githubRepoDetail");detail.replaceChildren();
  const heading=document.createElement("h3");heading.textContent=repo.fullName;
  const description=document.createElement("p");description.className="github-repo-description";description.textContent=repo.description||"Tidak ada deskripsi.";
  const facts=document.createElement("dl");facts.className="github-repo-facts";
  const addFact=(label,value)=>{const wrap=document.createElement("div");const dt=document.createElement("dt");dt.textContent=label;const dd=document.createElement("dd");dd.textContent=value;wrap.append(dt,dd);facts.append(wrap)};
  addFact("Visibilitas",repo.private?"Private":"Public");
  addFact("Default branch",repo.defaultBranch||"Tidak diketahui");
  addFact("Pemilik",repo.owner?.login||repo.fullName.split("/")[0]);
  addFact("Izin isi",repo.permissions?.contents||"Tidak tersedia");
  addFact("Izin pull request",repo.permissions?.pullRequests||"Tidak tersedia");
  const link=document.createElement("a");link.className="github-repo-open";link.href="https://github.com/"+repo.fullName;link.target="_blank";link.rel="noopener noreferrer";link.textContent="Buka di GitHub ↗";
  detail.append(heading,description,facts,link);
}
async function loadGitHubRepositories(){
  if(state!==AppState.AUTH||!currentUser||!githubConnection){toast("Connect the GitHub plugin first.");return}
  if(githubRepositoriesLoading)return;
  githubRepositoriesLoading=true;
  $("githubReposStatus").textContent="Memuat daftar repository…";
  $("githubReposRefresh").disabled=true;
  try{
    const installationData=await api("/api/github/installations");
    const installations=Array.isArray(installationData.installations)?installationData.installations:[];
    const results=await Promise.all(installations.map(item=>api("/api/github/repositories?installation_id="+encodeURIComponent(item.id))));
    const byId=new Map();
    for(const result of results)for(const repo of Array.isArray(result.repositories)?result.repositories:[])byId.set(repo.id,{...repo,owner:{login:repo.fullName.split("/")[0]}});
    githubRepositories=[...byId.values()];
    githubSelectedRepository=null;
    $("githubReposStatus").textContent=githubRepositories.length? "Pilih repository untuk melihat detailnya.":"Belum ada repository tersedia. Pastikan BOR AI sudah di-install pada akun atau organisasi GitHub yang benar.";
    $("githubRepoDetail").replaceChildren(Object.assign(document.createElement("p"),{textContent:"Pilih repository untuk melihat detailnya."}));
    renderGitHubRepositories();
  }catch(error){
    $("githubReposStatus").textContent=error.message||"Daftar repository gagal dimuat.";
    $("githubReposList").replaceChildren();
    $("githubRepoDetail").replaceChildren(Object.assign(document.createElement("p"),{textContent:"Coba muat ulang. Jika masih gagal, periksa izin instalasi GitHub App."}));
  }finally{githubRepositoriesLoading=false;$("githubReposRefresh").disabled=false}
}
function openGitHubRepositories(){
  if(state!==AppState.AUTH||!currentUser){toast("Masuk dengan akun Google terlebih dahulu.");return}
  if(!githubConnection){toast("Connect the GitHub plugin first.");pluginsDialog.showModal();return}
  if(!$("githubReposDialog").open)$("githubReposDialog").showModal();
  loadGitHubRepositories();
}

/* ---------- 3. Google Sign-In ---------- */
const gsi={status:"idle",clientId:null,nonce:null,nonceAt:0,loading:null};
const NONCE_MAX_AGE_MS=4*60*1000; /* cookie nonce server berumur 5 menit */
const GSI_MESSAGES={
  loading:"Menyiapkan login Google…",
  "not-configured":"Login Google belum dikonfigurasi di server. Anda tetap bisa memakai Guest.",
  "sdk-failed":"Google Sign-In gagal dimuat (periksa koneksi atau pemblokir konten). Anda tetap bisa memakai Guest.",
  error:"Login Google belum siap. Anda tetap bisa memakai Guest."
};
function setGsiStatus(status,detail){
  gsi.status=status;
  const ready=status==="ready";
  const text=ready?"":(detail||GSI_MESSAGES[status]||"");
  $("googleButtonGate").hidden=!ready;$("googleDisabled").hidden=ready;
  $("googleReason").textContent=text;$("googleReason").hidden=!text;
  $("googleRetry").hidden=!(status==="sdk-failed"||status==="error");
  $("googleSideStatus").textContent=text;$("googleSideStatus").hidden=!text||(state===AppState.AUTH);
}
function waitForGsiSdk(){
  if(window.google?.accounts?.id)return Promise.resolve();
  return new Promise(resolve=>{
    const sdk=document.querySelector('script[src*="accounts.google.com/gsi/client"]');let done=false;
    const finish=()=>{if(!done){done=true;resolve()}};
    sdk?.addEventListener("load",finish,{once:true});sdk?.addEventListener("error",finish,{once:true});setTimeout(finish,7000);
  });
}
async function refreshNonce(){
  const d=await api("/api/auth/nonce");
  gsi.nonce=d.nonce;gsi.nonceAt=Date.now();
  window.google.accounts.id.initialize({client_id:gsi.clientId,nonce:gsi.nonce,auto_select:false,callback:handleGoogleCredential});
}
function renderGoogleButtons(){
  if(gsi.status!=="ready"||!window.google?.accounts?.id)return;
  const opts={theme:"filled_black",size:"large",shape:"pill",text:"continue_with"};
  window.google.accounts.id.renderButton($("googleButtonGate"),{...opts,width:260});
  window.google.accounts.id.renderButton($("googleButton"),{...opts,width:220});
}
function loadGoogle(force=false){
  if(state===AppState.AUTH)return Promise.resolve();
  if(gsi.loading)return gsi.loading;
  if(gsi.status==="ready"&&!force){renderGoogleButtons();return Promise.resolve()}
  gsi.loading=(async()=>{
    setGsiStatus("loading");
    try{
      const cfg=await api("/api/config");
      if(!cfg.googleSignInEnabled||!cfg.googleClientId){setGsiStatus("not-configured");return}
      gsi.clientId=cfg.googleClientId;
      await waitForGsiSdk();
      if(!window.google?.accounts?.id){setGsiStatus("sdk-failed");return}
      await refreshNonce();
      setGsiStatus("ready");renderGoogleButtons();
    }catch(e){setGsiStatus("error",e.message?("Login Google belum siap: "+e.message):undefined)}
  })().finally(()=>{gsi.loading=null});
  return gsi.loading;
}
/* Nonce sisi server kedaluwarsa 5 menit: perbarui diam-diam agar halaman yang dibiarkan terbuka tetap bisa login. */
async function refreshNonceIfStale(){
  if(gsi.status!=="ready"||state===AppState.AUTH||document.hidden)return;
  if(Date.now()-gsi.nonceAt<NONCE_MAX_AGE_MS)return;
  try{await refreshNonce();renderGoogleButtons()}catch{}
}
setInterval(refreshNonceIfStale,60*1000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshNonceIfStale()});

async function handleGoogleCredential(result){
  try{
    const d=await postJson("/api/auth/google",{credential:result.credential,nonce:gsi.nonce});
    currentUser=d.user;writeGuestFlag(false);
    setState(AppState.AUTH);await enterChat();toast("Berhasil masuk dengan Google");
  }catch(e){
    toast(e.message||"Login Google gagal");
    if(state!==AppState.AUTH)refreshNonce().then(renderGoogleButtons).catch(()=>{});
  }
}
async function signOut(){
  try{await api("/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json"}})}
  catch{toast("Gagal keluar dari akun");return}
  try{window.google?.accounts?.id?.disableAutoSelect()}catch{}
  clearSessionData();writeGuestFlag(false);
  if(accountDialog.open)accountDialog.close();
  history.replaceState({borai:1},"",location.pathname+location.search);
  setState(AppState.UNAUTH);loadGoogle(true);
}

/* ---------- 4. Router (hash) + History API ---------- */
const ROUTE_RE=/^#\/c\/([a-zA-Z0-9-]{8,80})$/;
const currentRoute=()=>{const m=ROUTE_RE.exec(location.hash);return m?{name:"chat",id:m[1]}:{name:"new"}};
const routeHash=r=>r.name==="chat"?"#/c/"+r.id:"#/";
const hashNow=()=>location.hash||"#/";
function pushRoute(r){if(routeHash(r)!==hashNow())history.pushState({borai:1,route:r},"",routeHash(r))}
function replaceRoute(r){history.replaceState({borai:1,route:r},"",routeHash(r))}
/* Pindah rute dari aksi pengguna. Jika drawer terbuka, entri drawer DIGANTI (bukan ditumpuk) agar Back kembali ke rute sebelumnya. */
function commitRoute(r){
  if(drawerOpen){
    if(routeHash(r)===hashNow()){closeDrawer();return}
    closeDrawerDom();replaceRoute(r);return;
  }
  pushRoute(r);
}
async function applyRoute(){
  if(!inChatView())return;
  const r=currentRoute();
  if(r.name==="chat"){
    let ok=false;
    if(conversations.some(c=>c.id===r.id))ok=await showChat(r.id);
    else if(state===AppState.AUTH)ok=await openRemoteChat(r.id);
    if(ok||ok===null)return;
    toast("Chat tidak ditemukan");replaceRoute({name:"new"});
  }
  resetChatView();renderHistory();
}
async function openRemoteChat(cid){
  try{
    const d=await api("/api/conversations/"+encodeURIComponent(cid));
    if(!conversations.some(c=>c.id===cid))conversations.push({id:cid,serverId:cid,title:d.conversation?.title||"Percakapan",pinned:Boolean(d.conversation?.pinned),messages:d.messages||[],truncated:Boolean(d.truncated),updated:(d.conversation?.updated_at||0)*1000,loaded:true});
    return showChat(cid);
  }catch{return false}
}
window.addEventListener("popstate",e=>{
  const s=e.state;
  if(memoryOpen&&s?.overlay!=="memory"){
    closeMemoryDom(false);
    if(s?.overlay==="account"&&state===AppState.AUTH&&!accountDialog.open){accountDialog.showModal();accountView("home");}
    return;
  }
  if(s?.overlay==="memory"){if(state===AppState.AUTH&&!memoryOpen)openMemoryDom();return}
  if(s?.overlay==="account"){
    if(state===AppState.AUTH&&!accountDialog.open){accountDialog.showModal();accountView("home");}
    return;
  }
  if(accountDialog.open){accountDialog.close();return}
  if(drawerOpen&&s?.overlay!=="drawer"){closeDrawerDom();return}           /* Back menutup drawer */
  if(s?.overlay==="drawer"){if(isDrawerMode()&&inChatView()&&!drawerOpen)openDrawerDom();return} /* Forward ke entri drawer */
  applyRoute();                                                              /* prioritas 3: rute in-app */
});

/* ---------- 5. Drawer (<=1024px) ---------- */
const mq=window.matchMedia("(max-width:1024px)");
let drawerOpen=false,lastFocus=null;
const isDrawerMode=()=>mq.matches;
function syncInert(){
  const dm=isDrawerMode();
  sidebar.inert=dm&&!drawerOpen;workspace.inert=dm&&drawerOpen;
}
function openDrawerDom(){
  if(drawerOpen)return;
  drawerOpen=true;lastFocus=document.activeElement;
  sidebar.classList.add("open");backdrop.hidden=false;document.body.classList.add("drawer-open");
  menuBtn.setAttribute("aria-expanded","true");menuBtn.setAttribute("aria-label","Tutup menu");
  syncInert();$("drawerClose").focus();
}
function closeDrawerDom(restoreFocus=true){
  if(!drawerOpen)return;
  drawerOpen=false;
  sidebar.classList.remove("open");backdrop.hidden=true;document.body.classList.remove("drawer-open");
  menuBtn.setAttribute("aria-expanded","false");menuBtn.setAttribute("aria-label","Buka menu");
  syncInert();
  if(restoreFocus&&lastFocus&&lastFocus.isConnected&&!sidebar.contains(lastFocus))lastFocus.focus();
  else if(restoreFocus)menuBtn.focus();
}
function openDrawer(){
  if(!isDrawerMode()||drawerOpen||!inChatView())return;
  history.pushState({borai:1,overlay:"drawer",route:currentRoute()},"",location.href);
  openDrawerDom();
}
function closeDrawer(){
  if(!drawerOpen)return;
  if(history.state?.overlay==="drawer")history.back(); /* popstate yang menutup DOM */
  else closeDrawerDom();
}
menuBtn.addEventListener("click",()=>drawerOpen?closeDrawer():openDrawer());
$("drawerClose").addEventListener("click",closeDrawer);
backdrop.addEventListener("click",closeDrawer);
document.addEventListener("keydown",e=>{if(e.key!=="Escape")return;if(memoryOpen){e.preventDefault();closeMemory()}else if(drawerOpen){e.preventDefault();closeDrawer()}});
mq.addEventListener("change",()=>{if(!isDrawerMode())closeDrawerDom(false);syncInert()});

/* ---------- 5b. Memori (opsional, hanya akun login) ---------- */
const memoryPanel=$("memoryPanel");let memoryOpen=false,memoryLastFocus=null;
function memoryErr(message){const el=$("memoryError");el.textContent=message||"";el.hidden=!message}
function renderMemory(data){
  $("memoryToggle").checked=Boolean(data.enabled);
  const list=$("memoryList");list.replaceChildren();
  $("memoryEmpty").hidden=data.memories.length>0;
  for(const m of data.memories){
    const li=document.createElement("li");li.className="memory-item";
    const text=document.createElement("span");text.textContent=m.content;
    const del=document.createElement("button");del.type="button";del.className="memory-del";del.textContent="Hapus";del.setAttribute("aria-label","Hapus memori: "+m.content);
    del.addEventListener("click",async()=>{try{await api("/api/memory/"+encodeURIComponent(m.id),{method:"DELETE"});memoryErr("");await loadMemory()}catch(e){memoryErr(e.message)}});
    li.append(text,del);list.append(li);
  }
  $("memoryCount").textContent=data.memories.length+" / "+data.limits.maxItems;
  $("memoryClearAll").hidden=!data.memories.length;
}
async function loadMemory(){
  try{renderMemory(await api("/api/memory"));memoryErr("")}
  catch(e){memoryErr(e.code==="memory_unavailable"?"Memori belum tersedia di server (migrasi database belum diterapkan).":(e.message||"Gagal memuat memori."))}
}
function openMemoryDom(){
  if(memoryOpen)return;
  memoryOpen=true;memoryLastFocus=document.activeElement;memoryPanel.hidden=false;
  document.body.classList.add("drawer-open");$("app").inert=true;$("memoryInput").value="";memoryErr("");$("memoryClose").focus();
}
function closeMemoryDom(restoreFocus=true){
  if(!memoryOpen)return;
  memoryOpen=false;memoryPanel.hidden=true;$("app").inert=false;
  if(!drawerOpen)document.body.classList.remove("drawer-open");
  if(restoreFocus&&memoryLastFocus&&memoryLastFocus.isConnected)memoryLastFocus.focus();
}
function openMemory(){
  if(state!==AppState.AUTH){toast("Masuk dengan Google untuk memakai Memori.");return}
  if(memoryOpen)return;
  history.pushState({borai:1,overlay:"memory",route:currentRoute()},"",location.href);
  openMemoryDom();loadMemory();
}
function closeMemory(){if(!memoryOpen)return;if(history.state?.overlay==="memory")history.back();else closeMemoryDom()}
async function addMemoryItem(){
  const input=$("memoryInput");const content=input.value.trim();if(!content)return;
  try{await postJson("/api/memory",{content});input.value="";memoryErr("");await loadMemory()}
  catch(e){memoryErr(e.message)}
}
/* ---------- Daily usage visibility ---------- */
async function loadUsage(){
  const summary=$("usageSummary"),error=$("usageError"),fill=$("usageFill"),reset=$("usageReset");
  summary.textContent="Memuat penggunaan…";error.hidden=true;fill.style.width="0%";
  try{
    const d=await api("/api/usage");
    const percent=d.limit>0?Math.min(100,Math.round(d.used/d.limit*100)):0;
    summary.textContent=(d.scope==="user"?"Akun Google":"Guest")+" · "+d.used+" / "+d.limit+" unit";
    fill.style.width=percent+"%";
    $("usageRemaining").textContent=d.remaining+" unit tersisa hari ini";
    reset.textContent="Reset "+new Date(d.resetsAt).toLocaleString("id-ID",{timeZone:"Asia/Jakarta",hour:"2-digit",minute:"2-digit",day:"numeric",month:"short"})+" WIB";
  }catch(e){
    summary.textContent="Penggunaan belum dapat ditampilkan.";
    error.textContent=e.code==="usage_unavailable"?"Data penggunaan belum tersedia di server.":e.message;
    error.hidden=false;
    $("usageRemaining").textContent="";
    reset.textContent="";
  }
}
$("openUsage").addEventListener("click",()=>{
  const panel=$("usagePanel");
  panel.hidden=!panel.hidden;
  $("openUsage").setAttribute("aria-expanded",String(!panel.hidden));
  if(!panel.hidden)loadUsage();
});
$("refreshUsage").addEventListener("click",loadUsage);

$("openMemory").addEventListener("click",openMemory);
$("memoryClose").addEventListener("click",closeMemory);
memoryPanel.addEventListener("click",e=>{if(e.target===memoryPanel)closeMemory()});
$("memoryToggle").addEventListener("change",async e=>{
  const want=e.target.checked;
  try{await api("/api/memory/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:want})});memoryErr("")}
  catch(err){e.target.checked=!want;memoryErr(err.message)}
});
$("memoryAdd").addEventListener("click",addMemoryItem);
$("memoryInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();addMemoryItem()}});
$("memoryClearAll").addEventListener("click",async()=>{
  if(!confirm("Hapus semua memori? Tindakan ini tidak bisa dibatalkan."))return;
  try{await api("/api/memory",{method:"DELETE"});memoryErr("");await loadMemory()}catch(e){memoryErr(e.message)}
});

/* ---------- 6. Chat ---------- */
const sortedConversations=()=>[...conversations].sort((a,b)=>Number(Boolean(b.pinned))-Number(Boolean(a.pinned))||(b.updated||0)-(a.updated||0)||String(b.id).localeCompare(String(a.id)));
function renderHistory(){
  const nav=$("history");nav.replaceChildren();
  if(!inChatView()){$("historyCount").textContent="";return}
  $("historyLabel").textContent=archivedView?"Arsip":state===AppState.AUTH?"Riwayat akun":"Sesi ini · Guest Mode";
  $("historyCount").textContent=conversations.length?String(conversations.length):"";
  $("toggleArchived").textContent=(archivedView?"▤ ":"▣ ")+(window.BORLocale?.translate?.(archivedView?"Lihat riwayat":"Lihat arsip")||(archivedView?"Lihat riwayat":"Lihat arsip"));
  $("toggleArchived").setAttribute("aria-pressed",String(archivedView));
  const query=historyQuery.toLocaleLowerCase();
  const visible=sortedConversations().filter(c=>Boolean(c.archived)===archivedView&&(!query||String(c.title||"").toLocaleLowerCase().includes(query)||(state===AppState.GUEST&&c.messages.some(m=>String(m.content||"").toLocaleLowerCase().includes(query)))));
  for(const c of visible){
    const row=document.createElement("div");row.className="history-row";
    const b=document.createElement("button");b.className="history-item"+(c.id===activeId?" active":"");b.type="button";
    if(c.id===activeId)b.setAttribute("aria-current","page");
    const icon=document.createElement("span");icon.textContent="▤";icon.setAttribute("aria-hidden","true");
    const title=document.createElement("span");title.textContent=window.BORLocale?.translateTitle?.(c.title||"Percakapan baru")||(c.title||"Percakapan baru");
    b.append(icon,title);b.title=c.title||"Percakapan baru";b.onclick=()=>selectChat(c.id);
    const pin=document.createElement("button");pin.className="pin-chat";pin.type="button";pin.textContent=c.pinned?"★":"☆";pin.title=c.pinned?"Lepas sematan":"Sematkan";pin.setAttribute("aria-label",(c.pinned?"Lepas sematan ":"Sematkan ")+(c.title||"chat"));pin.setAttribute("aria-pressed",String(Boolean(c.pinned)));pin.onclick=e=>{e.stopPropagation();pinChat(c.id)};
    const archive=document.createElement("button");archive.className="archive-chat";archive.type="button";archive.textContent=archivedView?"↩":"▣";archive.title=archivedView?"Pulihkan dari arsip":"Arsipkan";archive.setAttribute("aria-label",(archivedView?"Pulihkan dari arsip ":"Arsipkan ")+(c.title||"chat"));archive.onclick=e=>{e.stopPropagation();archiveChat(c.id)};
    const rename=document.createElement("button");rename.className="rename-chat";rename.type="button";rename.textContent="✎";rename.title="Ubah judul";rename.setAttribute("aria-label","Ubah judul "+(c.title||"chat"));
    rename.onclick=e=>{e.stopPropagation();renameChat(c.id)};
    const del=document.createElement("button");del.className="delete-chat";del.type="button";del.textContent="×";del.title="Hapus chat";del.setAttribute("aria-label","Hapus "+(c.title||"chat"));
    del.onclick=e=>{e.stopPropagation();deleteChat(c.id)};
    const menu=document.createElement("details");menu.className="history-menu";
    const summary=document.createElement("summary");summary.textContent="⋯";summary.setAttribute("aria-label","Opsi percakapan "+(c.title||"chat"));
    const actions=document.createElement("div");actions.className="history-actions";
    for(const [button,label] of [[pin,c.pinned?"Lepas sematan":"Sematkan"],[archive,archivedView?"Pulihkan dari arsip":"Arsipkan"],[rename,"Ubah judul"],[del,"Hapus chat"]]){button.textContent=label;actions.append(button);}
    menu.append(summary,actions);row.append(b,menu);nav.append(row);
  }
  if(!visible.length){
    const empty=document.createElement("p");empty.className="history-empty";empty.textContent=query?"Tidak ada percakapan yang cocok.":archivedView?"Belum ada percakapan yang diarsipkan.":"Belum ada percakapan.";nav.append(empty);
  }
  if(state===AppState.AUTH&&historyHasMore){
    const more=document.createElement("button");more.type="button";more.className="history-load-more";
    more.textContent=historyLoadingMore?"Memuat…":"Muat lebih banyak";
    more.disabled=historyLoadingMore;more.setAttribute("aria-label","Muat lebih banyak percakapan");
    more.addEventListener("click",loadMoreHistory);nav.append(more);
  }
}
/* Menampilkan chat tanpa menyentuh history; pemanggil yang menentukan rute.
   Mengembalikan true (tampil), false (gagal/tidak ada), atau null (dibatalkan oleh navigasi yang lebih baru). */
async function showChat(cid){
  const c=conversations.find(x=>x.id===cid);if(!c)return false;
  const seq=++navSeq;
  if(state===AppState.AUTH&&!c.loaded&&c.serverId){
    loadingChat=true;lockComposer();
    try{
      const d=await api("/api/conversations/"+encodeURIComponent(c.serverId));
      if(seq!==navSeq)return null;
      c.messages=d.messages||[];c.loaded=true;c.truncated=Boolean(d.truncated);c.title=d.conversation?.title||c.title;c.pinned=Boolean(d.conversation?.pinned);if(d.truncated)toast("Percakapan panjang: hanya 500 pesan terakhir yang ditampilkan.");
    }catch(e){if(seq!==navSeq)return null;toast(e.message||"Gagal memuat chat");return false}
    finally{if(seq===navSeq){loadingChat=false;lockComposer()}}
  }
  if(seq!==navSeq)return null;
  attachmentSequence++;releaseUnsentThumbnail();attachmentPending=null;activePdf=null;activeCsv=null;renderPdfAttachment();renderCsvAttachment();activeId=cid;$("exportConversation").hidden=false;$("printConversation").hidden=false;welcomeEl.hidden=true;messagesEl.hidden=false;messagesEl.replaceChildren();
  for(let i=0;i<c.messages.length;i++){const m=c.messages[i];const last=i===c.messages.length-1;const previous=i===c.messages.length-2;appendMessage(m.role,m.content,false,{edit:m.role==="user"&&previous&&c.messages.at(-1)?.role==="assistant",regenerate:m.role==="assistant"&&last&&c.messages.at(-2)?.role==="user",responseId:m.role==="assistant"?m.id:null,conversationId:c.serverId||c.id,feedback:m.feedback||null,previewUrl:m.previewUrl||null});if(m.role==="assistant"&&m.links?.length)appendSources(m.links);if(m.role==="assistant"&&m.pdf)appendPdfSource(m.pdf);if(m.role==="assistant"&&m.spreadsheet)appendSpreadsheetSource(m.spreadsheet);if(m.role==="assistant"&&m.wordDocument)appendWordDocumentSource(m.wordDocument);}
  $("workflow").hidden=true;renderHistory();conversation.scrollTop=conversation.scrollHeight;
  return true;
}
async function selectChat(cid){
  if(!(await showChat(cid)))return;
  commitRoute({name:"chat",id:cid});
}
function newChat(){
  resetChatView();renderHistory();commitRoute({name:"new"});
  if(!isDrawerMode())promptEl.focus();
}
async function enterChat(){
  conversations=[];resetChatView();
  /* Kunci composer selama riwayat dimuat: applyRoute() akan mereset tampilan, sehingga pesan yang dikirim lebih awal akan hilang. */
  loadingChat=true;lockComposer();
  try{
    if(state===AppState.AUTH){try{await syncUserHistory()}catch(e){toast(e.message||"Gagal memuat riwayat")}}
    renderHistory();
    await applyRoute();
  }finally{loadingChat=false;lockComposer()}
}
async function syncUserHistory(query=historyQuery,append=false){
  const nextQuery=String(query||"").trim().slice(0,100);
  if(!append){historyRequestSeq++;historyQuery=nextQuery;historyCursor=null;historyHasMore=false;historyLoadingMore=false;}
  const requestSeq=historyRequestSeq;
  const params=new URLSearchParams();
  if(historyQuery)params.set("q",historyQuery);
  if(archivedView)params.set("archived","1");
  if(append&&historyCursor){
    params.set("cursorPinned",String(historyCursor.pinned));
    params.set("cursorUpdated",String(historyCursor.updated));
    params.set("cursorId",historyCursor.id);
  }
  const suffix=params.toString()?"?"+params.toString():"";
  const d=await api("/api/conversations"+suffix);
  if(requestSeq!==historyRequestSeq)return;
  const incoming=(d.conversations||[]).map(c=>({id:c.id,serverId:c.id,title:c.title,pinned:Boolean(c.pinned),archived:Boolean(c.archived),messages:[],updated:(c.updated_at||0)*1000,loaded:false}));
  if(append){
    const known=new Set(conversations.map(c=>c.id));
    conversations=conversations.concat(incoming.filter(c=>!known.has(c.id)));
  }else conversations=incoming;
  historyHasMore=Boolean(d.hasMore);
  historyCursor=d.nextCursor||null;
}
async function loadMoreHistory(){
  if(historyLoadingMore||!historyHasMore||state!==AppState.AUTH)return;
  historyLoadingMore=true;renderHistory();
  try{await syncUserHistory(historyQuery,true)}
  catch(error){toast(error.message||"Gagal memuat halaman riwayat")}
  finally{historyLoadingMore=false;renderHistory()}
}
/* Konteks yang dikirim ke server. Sama dengan batas di server (12 pesan / 8000 karakter / 2000 per pesan);
   giliran yang gagal tidak pernah masuk chat.messages sehingga tidak ikut terkirim. */
function buildHistory(chat){
  const out=[];let total=0;
  for(let i=chat.messages.length-1;i>=0&&out.length<12;i--){
    const m=chat.messages[i];const content=String(m.content||"").trim().slice(0,2000);
    if(!content)continue;if(total+content.length>8000)break;
    total+=content.length;out.unshift({role:m.role==="assistant"?"assistant":"user",content});
  }
  while(out.length&&out[0].role!=="user")out.shift();
  return out;
}
/* Kebijakan kegagalan: giliran yang gagal TIDAK disimpan (server atomik: pesan user + jawaban disimpan bersamaan hanya jika AI berhasil).
   Gelembung error hanya tampil di layar ini, punya tombol "Coba lagi", dan hilang saat chat dimuat ulang. */
/* Menunjukkan link mana yang benar-benar terbaca (atau gagal dan kenapa) di bawah jawaban; teks diisi lewat textContent. */
function appendSources(links){
  const row=messagesEl.lastElementChild;const body=row&&row.querySelector(".message-body");if(!body||!links||!links.length)return;
  const box=document.createElement("div");box.className="sources";
  const grounded=links.filter(link=>link.sourceType==="web_search_v2");
  if(grounded.length)renderInlineWebCitations(body.querySelector(".message-text"),grounded);
  const head=document.createElement("strong");
  head.textContent=grounded.length?(window.BORLocale?.current==="id"?"Sumber web":"Web sources"):"Sumber yang dibaca:";
  box.append(head);
  for(const l of links){
    const item=document.createElement("div");item.className="source "+(l.ok?"ok":"fail");
    if(l.ok){
      item.append(document.createTextNode("✓ ["+l.sourceId+"] "));
      if(typeof l.url==="string"&&/^https?:\/\//i.test(l.url)){
        const link=document.createElement("a");link.href=l.url;link.target="_blank";link.rel="noopener noreferrer";
        link.textContent=l.url+(l.title?" — "+l.title:"");item.append(link);
        if(l.resolvedUrl&&l.resolvedUrl!==l.url){const redirect=document.createElement("small");redirect.textContent="Dialihkan ke "+l.resolvedUrl;item.append(redirect);}
      }else item.append(document.createTextNode(l.host+(l.title?" — "+l.title:"")));
      if(l.sourceType==="news")item.append(document.createTextNode(" · Berita"));
      else if(l.sourceType==="search")item.append(document.createTextNode(" · Pencarian web"));
      else if(l.sourceType==="curated")item.append(document.createTextNode(" · Basis pengetahuan resmi"));
      if(l.sourceType==="news"||l.sourceType==="search"){
        if(l.pageRead)item.append(document.createTextNode(" · Isi halaman berhasil dibaca"+(l.pageTruncated?" (cuplikan dipotong)":"")));
        else if(l.pageRead===false)item.append(document.createTextNode(" · Hanya cuplikan pencarian"+(l.pageReason?": "+l.pageReason:"")));
      }
      if(l.publishedAt){const date=new Date(l.publishedAt);if(!Number.isNaN(date.getTime()))item.append(document.createTextNode(" · Terbit "+date.toLocaleDateString()));}
      else if(l.sourceType==="news"||l.sourceType==="search")item.append(document.createTextNode(" · Tanggal publikasi tidak tersedia"));
      if(l.trust==="unverified-external")item.append(document.createTextNode(" · Sumber eksternal, belum diverifikasi"));
      if(l.trust==="official-curated")item.append(document.createTextNode(" · Dokumen resmi terkurasi"));
      if(l.truncated)item.append(document.createTextNode(" (dipotong)"));
    }else item.textContent="✗ "+(l.host||"sumber")+" — "+(l.reason||"tidak tersedia");
    box.append(item);
  }
  body.append(box);
}
function clickableWebCitation(source,label){
  let url;
  try{url=new URL(source.url);}catch{return null;}
  if(url.protocol!=="https:"||url.username||url.password||url.port)return null;
  const link=document.createElement("a");
  link.className="web-citation";
  link.href=url.href;link.target="_blank";link.rel="noopener noreferrer";
  link.textContent=label;link.title=source.title||url.hostname;
  return link;
}
function renderInlineWebCitations(container,links){
  if(!container)return;
  const byId=new Map(links.map(link=>[String(link.sourceId),link]));
  const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT);
  const nodes=[];
  for(let node=walker.nextNode();node;node=walker.nextNode())if(node.data.includes("⟦"))nodes.push(node);
  for(const node of nodes){
    if(node.parentElement.closest("a"))continue;
    const pieces=node.data.split(/⟦(\d+)⟧/g);
    node.replaceWith(...pieces.map((piece,index)=>{
      if(index%2===0)return document.createTextNode(piece);
      const source=byId.get(piece);
      return (source&&clickableWebCitation(source,"["+piece+"]"))||document.createTextNode("");
    }));
  }
}
function appendGoogleGrounding(grounding){
  const body=messagesEl.lastElementChild?.querySelector(".message-body");
  if(!body||!grounding?.suggestions?.length||!grounding?.blocks?.length)return;
  const panel=document.createElement("section");
  const content=document.createElement("div");
  content.hidden=true;
  for(const block of grounding.blocks){
    const paragraph=document.createElement("div");
    paragraph.className="grounded-google-text";
    let cursor=0;
    const chars=Array.from(block.text);
    const citations=block.citations.filter(item=>Number.isInteger(item.end)&&item.end>0&&item.end<=chars.length)
      .sort((left,right)=>left.end-right.end);
    for(const item of citations){
      paragraph.append(chars.slice(cursor,item.end).join(""));
      const link=clickableWebCitation(item,item.host);
      if(link)paragraph.append(" ",link," ");
      cursor=item.end;
    }
    paragraph.append(chars.slice(cursor).join(""));
    content.append(paragraph);
  }
  const frame=document.createElement("iframe");
  frame.className="grounded-google-widget";
  frame.title="Google Search";
  frame.setAttribute("sandbox","allow-scripts allow-popups allow-popups-to-escape-sandbox");
  frame.referrerPolicy="no-referrer";
  frame.src="/api/web-search/grounding-frame";
  const status=document.createElement("p");
  const indonesian=window.BORLocale?.current==="id";
  status.textContent=indonesian?"Memuat hasil Google…":"Loading Google results…";
  const finish=ok=>{
    clearTimeout(timeout);
    window.removeEventListener("message",receive);
    if(ok){content.hidden=false;status.remove();}
    else{frame.remove();status.textContent=indonesian?"Hasil Google tidak dapat ditampilkan.":"Google results could not be displayed.";}
  };
  const receive=event=>{
    if(event.source===frame.contentWindow&&event.origin==="null"&&event.data?.type==="bor-google-grounding-ready")finish(event.data.ok===true);
  };
  const timeout=setTimeout(()=>finish(false),4000);
  window.addEventListener("message",receive);
  frame.addEventListener("load",()=>frame.contentWindow?.postMessage({type:"bor-google-grounding",suggestions:grounding.suggestions},"*"),{once:true});
  panel.append(status,content,frame);
  body.append(panel);
}
/* Auditable tool summary. Only report actual server activity, never pretend Google was opened. */
function appendToolActivity(items) {
  const row=messagesEl.lastElementChild,body=row?.querySelector(".message-body");
  if(!body||!Array.isArray(items)||!items.length)return;
  const details=document.createElement("details");details.className="tool-activity";
  const summary=document.createElement("summary");summary.textContent="Proses alat yang digunakan";details.append(summary);
  const list=document.createElement("ul");
  for(const item of items.slice(0,5)){
    if(!["web_search","read_links"].includes(item?.tool))continue;
    const line=document.createElement("li");
    const noun=item.tool==="web_search"?"Pencarian web":"Pembacaan tautan";
    const provider=item.tool==="web_search"&&["Tavily","Brave","OpenAI","Google"].includes(item.provider)?" ("+item.provider+")":"";
    if(item.version===2){
      const indonesian=window.BORLocale?.current==="id";
      const label=(indonesian?"Pencarian web":"Web search")+provider;
      line.textContent=label+" · "+(item.status==="completed"?(indonesian?"Selesai":"Completed"):(indonesian?"Sumber tidak tersedia":"Sources unavailable"));
      if(item.corroboration==="limited")line.textContent+=indonesian?" · Konfirmasi lintas sumber terbatas":" · Limited cross-source corroboration";
    }else line.textContent=noun+provider+" · "+(item.status==="completed"?(Number(item.count)||0)+" sumber berhasil":"Tidak tersedia atau gagal");
    list.append(line);
  }
  if(!list.children.length)return;details.append(list);body.append(details);
}
function appendFormDraft(draft) {
  const row=messagesEl.lastElementChild,body=row?.querySelector(".message-body");
  if(!body||draft?.kind!=="google-forms-apps-script"||typeof draft.script!=="string"||draft.script.length>30000)return;
  const panel=document.createElement("section");panel.className="form-draft";
  const title=document.createElement("strong");title.textContent=draft.title||"Rancangan Google Forms";
  const notice=document.createElement("p");
  notice.textContent="Draf formulir siap. Belum dibuat di Google; kamu perlu menjalankan script dan meninjau link sebelum membagikannya.";
  const actions=document.createElement("div");actions.className="form-draft-actions";
  const copy=document.createElement("button");copy.type="button";copy.textContent="Salin Google Apps Script";
  copy.addEventListener("click",async()=>{
    try{await navigator.clipboard.writeText(draft.script);toast("Script berhasil disalin. Jalankan di akun Google milikmu.");}
    catch{toast("Gagal menyalin script. Periksa izin clipboard browser.");}
  });
  const open=document.createElement("a");
  open.href="https://script.google.com/home/projects/create";open.target="_blank";open.rel="noopener noreferrer";
  open.textContent="Buka Google Apps Script";
  const create=document.createElement("button");
  create.type="button";
  create.textContent="Buat langsung di Google Forms";
  create.addEventListener("click",async()=>{
    if(state!==AppState.AUTH||!currentUser){
      toast("Masuk menggunakan akun Google di BOR AI untuk membuat formulir langsung.");return;
    }
    const forms=window.BORGoogleForms;
    if(!forms?.validDraft?.(draft)){
      toast("Rancangan formulir tidak valid. Gunakan salinan Apps Script.");return;
    }
    if(!gsi.clientId||!window.google?.accounts?.oauth2?.initTokenClient){
      toast("Izin Google Forms belum tersedia. Gunakan salinan Apps Script atau periksa konfigurasi Google Cloud.");return;
    }
    if(!window.confirm("Buat satu Google Form BARU di akun Google yang kamu izinkan? Form akan belum dipublikasikan sampai kamu meninjaunya. BOR AI tidak akan menyimpan token akses."))return;
    create.disabled=true;
    create.textContent="Meminta izin Google…";
    // Initiate OAuth synchronously in this button click to avoid popup blockers.
    let pending;
    try {
      pending=forms.requestFormsAccess(gsi.clientId,window.google.accounts.oauth2);
    } catch {
      create.disabled=false;create.textContent="Buat langsung di Google Forms";
      toast("Gagal membuka izin Google Forms. Periksa konfigurasi aplikasi.");return;
    }
    try {
      const token=await pending;
      if(state!==AppState.AUTH){toast("Akun BOR AI telah keluar. Tidak ada perubahan formulir.");return;}
      create.textContent="Membuat formulir…";
      const created=await forms.createUnpublishedForm(draft,token,fetch.bind(window));
      const link=document.createElement("a");
      link.href=created.editUrl;
      link.rel="noopener noreferrer";
      link.target="_blank";
      link.textContent=created.complete?"Buka Google Form baru (belum dipublikasikan)":"Buka form yang dibuat untuk melengkapi pertanyaan";
      actions.append(link);
      create.hidden=true;
      notice.textContent=created.complete
        ?"Form berhasil dibuat melalui Google Forms API, masih belum menerima respons. Tinjau dan publikasikan sendiri di Google."
        :"Form kosong berhasil dibuat, tetapi pertanyaan belum tersimpan. Buka editor untuk menyelesaikannya. Jangan ulangi tombol untuk menghindari form duplikat.";
    } catch(error){
      notice.textContent="Pembuatan langsung belum berhasil. Periksa apakah Google Forms API dan izin OAuth telah diaktifkan untuk aplikasi. Alternatif: salin Apps Script.";
      toast(error?.message==="google_forms_access_denied"?"Akses Google Forms ditolak. Tidak ada formulir yang dibuat.":"Tidak dapat membuat form langsung. Gunakan Apps Script atau periksa izin Google.");
    } finally {
      create.disabled=false;
      if(!create.hidden)create.textContent="Buat langsung di Google Forms";
    }
  });
  actions.append(create,copy,open);panel.append(title,notice,actions);body.append(panel);
}
function appendPdfSource(pdf){
  const row=messagesEl.lastElementChild;const body=row&&row.querySelector(".message-body");if(!body||!pdf)return;
  const box=document.createElement("div");box.className="sources pdf-source";
  const head=document.createElement("strong");head.textContent="Dokumen PDF yang dibaca:";box.append(head);
  const item=document.createElement("div");item.className="source ok";
  item.textContent="✓ "+String(pdf.name||"document.pdf")+(pdf.pageCount?" · "+pdf.pageCount+" halaman":" · jumlah halaman tidak terdeteksi")+(pdf.truncated?" · teks dipotong untuk batas konteks":"");
  box.append(item);body.append(box);
}
// Only bounded, display-only file metadata is persisted in the user's text.
// Raw file bytes never enter chat storage. Extracted text is sent separately
// as the pre-existing bounded document context.
function releaseUnsentThumbnail(){
  if(attachmentThumbnailUrl){
    URL.revokeObjectURL(attachmentThumbnailUrl);
    attachmentThumbnailUrl=null;
  }
}
function keepSentThumbnail(url){
  if(!url||sentImageUrls.includes(url))return;
  sentImageUrls.push(url);
  // Bound client memory. History after a reload always has a file-type card,
  // not raw image pixels or a stale binary link.
  while(sentImageUrls.length>8){
    const removed=sentImageUrls.shift();
    URL.revokeObjectURL(removed);
    for(const chat of conversations)for(const m of chat.messages||[]){
      if(m.previewUrl===removed)m.previewUrl=null;
    }
  }
}
function showImageThumbnail(img,url,show){
  if(!img)return;
  if(!show||!url){
    img.hidden=true;
    if(img.dataset.url){img.removeAttribute("src");delete img.dataset.url;delete img.dataset.failed;}
    return;
  }
  if(img.dataset.url!==url){
    img.dataset.url=url;
    delete img.dataset.failed;
    img.onerror=()=>{img.dataset.failed=url;img.hidden=true;};
    img.src=url;
  }
  img.hidden=img.dataset.failed===url;
}
function safeAttachmentName(name){
  const clean=String(name||"lampiran").replace(/[\/\\\x00-\x1f\x7f]/g,"_").trim()||"lampiran";
  if(clean.length<=110)return clean;
  const ext=clean.match(/\.[a-z0-9]{1,5}$/i)?.[0]||"";
  return clean.slice(0,109-ext.length)+"…"+ext;
}
function attachmentFileType(name){
  const extension=(String(name||"").match(/\.([a-z0-9]{2,5})$/i)?.[1]||"file").toUpperCase();
  return ["PDF","DOCX","XLSX","CSV","PPTX","JPG","JPEG","PNG","WEBP"].includes(extension)?(extension==="JPEG"?"JPG":extension):"FILE";
}
function packAttachmentMessage(text,attached){
  return attached?text+"\n\n[BORAI_FILE:"+encodeURIComponent(safeAttachmentName(attached.name))+"]":text;
}
function unpackAttachmentMessage(content){
  const text=String(content||"");
  const marker=text.match(/\n\n\[BORAI_FILE:([A-Za-z0-9_.!~*'()%+-]{1,450})\]$/);
  if(!marker)return {text,attachment:null};
  try{
    const name=safeAttachmentName(decodeURIComponent(marker[1]));
    return {text:text.slice(0,-marker[0].length),attachment:{name,type:attachmentFileType(name)}};
  }catch{return {text,attachment:null};}
}
function buildSentFileCard(attached,previewUrl=null){
  const tile=document.createElement("div");tile.className="sent-file-card";
  const badge=document.createElement("span");badge.className="sent-file-type";
  badge.textContent=attached.type||attachmentFileType(attached.name);
  if(typeof previewUrl==="string"&&previewUrl.startsWith("blob:")){
    const img=document.createElement("img");img.className="sent-file-image";img.alt="";
    img.onerror=()=>{img.remove();badge.hidden=false;};
    img.src=previewUrl;badge.hidden=true;tile.append(img);
  }
  const summary=document.createElement("span");summary.className="sent-file-summary";
  const title=document.createElement("strong");title.textContent=safeAttachmentName(attached.name);
  const note=document.createElement("small");
  note.textContent=/\.(?:jpe?g|png|webp)$/i.test(attached.name)?"Dianalisis menggunakan AI vision":"Diproses secara lokal";
  summary.append(title,note);tile.append(badge,summary);return tile;
}
function renderAttachmentPreview(){
  const preview=$("attachmentPreview"),progress=$("attachmentProgress");
  const pending=attachmentPending;
  const pdf=pending||activePdf,csv=pending?null:activeCsv;
  const pWrap=$("pdfAttachment"),cWrap=$("csvAttachment");
  preview.hidden=!pdf&&!csv;
  pWrap.hidden=!pdf;cWrap.hidden=!csv;
  if(pdf){pWrap.dataset.filetype=attachmentFileType(pdf.name);$("pdfName").textContent=safeAttachmentName(pdf.name);}
  if(csv){cWrap.dataset.filetype=attachmentFileType(csv.name);$("csvName").textContent=safeAttachmentName(csv.name);}
  progress.hidden=!pending;
  progress.textContent=pending?(pending.error?"Gagal membaca: ":"")+(pending.stage||"Membaca file di perangkat…"):"";
  progress.dataset.error=pending?.error?"true":"false";
  preview.dataset.status=pending?(pending.error?"error":"processing"):(pdf||csv?"ready":"empty");
  $("clearPdf").setAttribute("aria-label","Lepas lampiran");
  $("clearCsv").setAttribute("aria-label","Lepas lampiran");

  const isImage=name=>/\.(?:jpe?g|png|webp)$/i.test(String(name||""));
  showImageThumbnail($("pdfThumbnail"),attachmentThumbnailUrl,Boolean(pdf&&isImage(pdf.name)));
  showImageThumbnail($("csvThumbnail"),attachmentThumbnailUrl,Boolean(csv&&isImage(csv.name)));
  $("attachPdf").textContent=pdf||csv?"＋ Ganti lampiran":"＋ Unggah file";
}
function renderPdfAttachment(){renderAttachmentPreview();}
function appendSpreadsheetSource(spreadsheet){
  const row=messagesEl.lastElementChild;const body=row&&row.querySelector(".message-body");if(!body||!spreadsheet)return;
  const box=document.createElement("div");box.className="sources csv-source";
  const head=document.createElement("strong");head.textContent="Spreadsheet yang dianalisis:";box.append(head);
  const item=document.createElement("div");item.className="source ok";
  item.textContent="✓ "+String(spreadsheet.name||"spreadsheet.csv")+(Number.isSafeInteger(spreadsheet.rowCount)?" · "+spreadsheet.rowCount.toLocaleString("id-ID")+" baris":"")+(Number.isSafeInteger(spreadsheet.columnCount)?" · "+spreadsheet.columnCount+" kolom":"")+(spreadsheet.truncated?" · ringkasan dibatasi":"");
  box.append(item);body.append(box);
}
function appendPresentationSource(p){const row=messagesEl.lastElementChild,body=row&&row.querySelector(".message-body");if(!body||!p)return;const box=document.createElement("div");box.className="sources presentation-source";const h=document.createElement("strong");h.textContent="Presentasi yang dianalisis:";const item=document.createElement("div");item.className="source ok";item.textContent="✓ "+String(p.name||"presentation.pptx")+(Number.isSafeInteger(p.slideCount)?" · "+p.slideCount+" slide":"")+(p.truncated?" · teks dibatasi":"");box.append(h,item);body.append(box)}
function appendWordDocumentSource(doc){
  const row=messagesEl.lastElementChild;const body=row&&row.querySelector(".message-body");if(!body||!doc)return;
  const box=document.createElement("div");box.className="sources word-document-source";
  const head=document.createElement("strong");head.textContent="Dokumen Word yang dianalisis:";box.append(head);
  const item=document.createElement("div");item.className="source ok";
  item.textContent="✓ "+String(doc.name||"document.docx")+(Number.isSafeInteger(doc.paragraphCount)?" · "+doc.paragraphCount.toLocaleString("id-ID")+" paragraf":"")+(doc.truncated?" · teks dibatasi":"");
  box.append(item);body.append(box);
}
function appendImageOcrSource(item){
  const row=messagesEl.lastElementChild,body=row?.querySelector(".message-body");if(!body)return;
  const box=document.createElement("div");box.className="sources image-ocr-source";
  const label=document.createElement("strong");label.textContent="Teks gambar (OCR lokal):";
  const detail=document.createElement("div");detail.className="source ok";
  detail.textContent="✓ "+item.name+" · Hanya teks dikenali, bukan analisis visual"+(item.truncated?" · teks dibatasi":"");
  box.append(label,detail);body.append(box);
}
function renderCsvAttachment(){renderAttachmentPreview();}
async function readPdfFile(file,onProgress){
  const {extractPdfLocally}=await import("/pdf-ocr.js");
  return extractPdfLocally(file,{
    pdfjs:window.pdfjsLib,tesseract:window.Tesseract,
    onProgress:({status,page,total})=>{
      const message=status==="loading-language"?"Mengunduh model OCR…":
        status==="recognizing"?"OCR halaman "+page+"/"+total+"…":
        status==="rendering"?"Memuat halaman "+page+"/"+total+"…":"Membaca PDF…";
      onProgress(message);
    }
  });
}
async function ensurePptxLibrary(){if(window.JSZip?.loadAsync)return window.JSZip;if(window.pptxLibraryLoading)return window.pptxLibraryLoading;window.pptxLibraryLoading=new Promise((resolve,reject)=>{const s=document.createElement("script");s.src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";s.onload=()=>window.JSZip?.loadAsync?resolve(window.JSZip):reject(Error("Pustaka PowerPoint tidak berhasil dimuat."));s.onerror=()=>reject(Error("Pustaka PowerPoint gagal diunduh. Periksa koneksi lalu coba lagi."));document.head.append(s)});try{return await window.pptxLibraryLoading}finally{window.pptxLibraryLoading=null}}
async function ensureXlsxLibrary(){
  if(window.XLSX?.read)return window.XLSX;
  if(window.xlsxLibraryLoading)return window.xlsxLibraryLoading;
  window.xlsxLibraryLoading=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
    script.onload=()=>window.XLSX?.read?resolve(window.XLSX):reject(new Error("Pustaka Excel tidak berhasil dimuat."));
    script.onerror=()=>reject(new Error("Pustaka Excel gagal diunduh. Periksa koneksi lalu coba lagi."));
    document.head.append(script);
  });
  try{return await window.xlsxLibraryLoading}finally{window.xlsxLibraryLoading=null}
}
async function readStructuredFile(file){
  const filename=file.name.toLowerCase();
  const isDocx=filename.endsWith(".docx"),isExcel=filename.endsWith(".xlsx"),isPptx=filename.endsWith(".pptx");
  if(isDocx){
    const jszip=await ensurePptxLibrary();
    const {parseDocxLocally}=await import("/docx-reader.js");
    const parsed=await parseDocxLocally(file,{jszip});
    return {...parsed,kind:"word-document"};
  }
  if(isPptx){
    const jszip=await ensurePptxLibrary();
    const {parsePptxLocally}=await import("/pptx-reader.js");
    const parsed=await parsePptxLocally(file,{jszip});
    return {...parsed,kind:"presentation"};
  }
  if(isExcel){
    const xlsx=await ensureXlsxLibrary();
    const {parseXlsxLocally}=await import("/xlsx-reader.js");
    return parseXlsxLocally(file,{xlsx});
  }
  const {parseCsvLocally}=await import("/csv-reader.js");
  return parseCsvLocally(file);
}
async function readImageFile(file,onProgress){
  const {prepareImageForVision}=await import("/image-vision.js");
  const prepared=await prepareImageForVision(file,{onProgress});
  // Keep original pixels only in volatile composer state for editing. Never in chat history.
  prepared.originalFile=file;
  return prepared;
}
async function uploadAnyFile(file){
  if(!file||busy||loadingChat)return;
  const name=safeAttachmentName(file.name),lower=String(file.name||"").toLowerCase();
  const pdf=lower.endsWith(".pdf"),image=/\.(?:jpe?g|png|webp)$/.test(lower);
  const structured=/\.(?:csv|xlsx|pptx|docx)$/.test(lower);
  if(!pdf&&!image&&!structured){toast("Format belum didukung. Pilih PDF, Word, Excel, PowerPoint, CSV, JPG, PNG, atau WEBP.");return;}
  const limit=pdf?8*1024*1024:5*1024*1024;
  if(file.size<1||file.size>limit){toast("Ukuran file harus 1 byte–"+(pdf?"8":"5")+" MB.");return;}
  const request=++attachmentSequence;
  releaseUnsentThumbnail();
  if(image&&URL.createObjectURL)attachmentThumbnailUrl=URL.createObjectURL(file);
  activePdf=null;activeCsv=null;
  attachmentPending={name,stage:image?"Menyiapkan foto untuk AI vision…":pdf?"Membaca halaman PDF…":"Membaca dokumen di perangkat…",error:false};
  $("attachmentMenu").open=false;
  renderAttachmentPreview();lockComposer();
  const onProgress=message=>{
    if(request!==attachmentSequence||!attachmentPending)return;
    attachmentPending.stage=String(message||"Membaca file…").slice(0,100);
    renderAttachmentPreview();
  };
  try{
    const parsed=pdf?await readPdfFile(file,onProgress):image?await readImageFile(file,onProgress):await readStructuredFile(file);
    // Changing chats, removing, or replacing files invalidates an in-flight OCR result.
    if(request!==attachmentSequence)return;
    if(pdf)activePdf=parsed;else activeCsv=parsed;
    attachmentPending=null;
    toast(image?"Foto siap. AI akan melihat dan menganalisisnya saat dikirim.":"File siap dikirim bersama pesan.");
  }catch(error){
    if(request!==attachmentSequence)return;
    attachmentPending={name,stage:String(error?.message||"File tidak dapat diproses.").slice(0,160),error:true};
    toast("Lampiran gagal diproses. Lepas atau ganti file.");
  }finally{
    if(request===attachmentSequence){renderAttachmentPreview();lockComposer();}
  }
}
function clearSelectedAttachment(){
  attachmentSequence++;releaseUnsentThumbnail();attachmentPending=null;activePdf=null;activeCsv=null;
  renderAttachmentPreview();lockComposer();
}
function appendFailedTurn(message,text,noRetry=false,requestId=null,attachmentData=null,previewUrl=null){
  appendMessage("assistant",message);
  const row=messagesEl.lastElementChild;const body=row&&row.querySelector(".message-body");if(!body)return;
  row.classList.add("failed");
  if(noRetry)return; /* batas harian: mencoba lagi sekarang percuma */
  const btn=document.createElement("button");btn.type="button";btn.className="retry-btn";btn.textContent="↻ Coba lagi";
  btn.addEventListener("click",()=>{
    if(busy||loadingChat)return;
    const prev=row.previousElementSibling;row.remove();if(prev&&prev.classList.contains("user"))prev.remove();
    promptEl.value=text;resizePrompt();submit({requestId,attachmentData,previewUrl});
  });
  body.append(btn);
}
async function submit(options={}){
  if(busy||routingImageRequest||loadingChat||!inChatView()||attachmentPending)return;
  const selectedPdf=options.attachmentData?.pdf||activePdf;
  const selectedCsv=options.attachmentData?.csv||activeCsv;
  const text=promptEl.value.trim()||((selectedPdf||selectedCsv)?"Tolong analisis isi file terlampir.":"");
  if(!text)return;
  if(!options.imageApproved){
    routingImageRequest=true;
    try{
      const {imageIntent}=await import("/image-intent.js");
      const mode=imageIntent(text,selectedCsv?.kind==="image-vision",$("imageTask").value);
      if(mode){await prepareImageRequest(text,mode,selectedCsv);return;}
    }finally{routingImageRequest=false;}
  }
  const savedText=packAttachmentMessage(text,selectedPdf||selectedCsv);
  if(savedText.length>12000){toast("Pesan terlalu panjang. Pendekkan teks sebelum mengirim lampiran.");return;}
  const replacing=options.replaceLastTurn===true;const previousTurn=options.previousTurn||null;
  const requestId=options.requestId||(pendingRetryRequest?.text===text&&pendingRetryRequest.conversationId===activeId?pendingRetryRequest.requestId:crypto.randomUUID());
  busy=true;activeChatController=new AbortController();lockComposer();const agent=$("agent").value;
  let createdNew=false;
  if(!activeId){activeId=id();createdNew=true;conversations.push({id:activeId,serverId:null,title:text.replace(/\s+/g," ").slice(0,72),messages:[],updated:Date.now(),loaded:true})}
  const chat=conversations.find(c=>c.id===activeId);$("exportConversation").hidden=false;$("printConversation").hidden=false;const startId=chat.id;
  const history=buildHistory(chat);const sentPreviewUrl=options.previewUrl||attachmentThumbnailUrl;
  if(attachmentThumbnailUrl===sentPreviewUrl)attachmentThumbnailUrl=null;
  keepSentThumbnail(sentPreviewUrl);
  const userEntry={role:"user",content:savedText,previewUrl:sentPreviewUrl||null};chat.messages.push(userEntry);chat.updated=Date.now();
  welcomeEl.hidden=true;messagesEl.hidden=false;appendMessage("user",savedText,true,{previewUrl:sentPreviewUrl});promptEl.value="";resizePrompt();clearSelectedAttachment();showTyping();renderHistory();
  if(createdNew)replaceRoute({name:"chat",id:chat.id});
  const stillActive=()=>activeId===startId;const start=Date.now();
  try{
    const payload={message:savedText,agent,requestId,imageMode:$("imageTask").value,language:window.BORLocale?.current||"en"};const customization=readCustomization();if(customization)payload.customization=customization;if(selectedPdf)payload.document={name:selectedPdf.name,content:selectedPdf.content,truncated:selectedPdf.truncated};if(selectedCsv?.kind==="image-vision")payload.imageVision={name:selectedCsv.name,dataUrl:selectedCsv.dataUrl};else if(selectedCsv?.kind==="image-ocr")payload.imageOcr={name:selectedCsv.name,content:selectedCsv.content,truncated:selectedCsv.truncated};else if(selectedCsv?.kind==="word-document")payload.wordDocument={name:selectedCsv.name,content:selectedCsv.content,paragraphCount:selectedCsv.paragraphCount,truncated:selectedCsv.truncated};else if(selectedCsv?.kind==="presentation")payload.presentation={name:selectedCsv.name,content:selectedCsv.content,slideCount:selectedCsv.slideCount,truncated:selectedCsv.truncated};else if(selectedCsv)payload.spreadsheet={name:selectedCsv.name,content:selectedCsv.content,rowCount:selectedCsv.rowCount,columnCount:selectedCsv.columnCount,truncated:selectedCsv.truncated};if(history.length)payload.history=history;if(state===AppState.AUTH&&chat.serverId)payload.conversationId=chat.serverId;if(replacing&&state===AppState.AUTH&&chat.serverId)payload.replaceLastTurn=true;
    const data=await postJson("/api/chat",payload,CHAT_TIMEOUT_MS,activeChatController.signal,selectedCsv?.kind==="image-vision",provider=>{
      if(!stillActive()||!["OpenAI","Google"].includes(provider))return;
      const typing=$("typing")?.querySelector(".message-body");
      if(!typing)return;
      let status=typing.querySelector('[role="status"]');
      if(!status){status=document.createElement("span");status.setAttribute("role","status");typing.append(" ",status);}
      status.textContent=(window.BORLocale?.current==="id"?"Mencari di web dengan ":"Searching the web with ")+provider+"…";
    });
    if(typeof data.response!=="string"||!data.response.trim())throw new Error("AI tidak menghasilkan jawaban.");
    if(pendingRetryRequest?.requestId===requestId)pendingRetryRequest=null;
    chat.messages.push({role:"assistant",content:data.response,id:data.responseId||null,feedback:null,links:data.links||[],pdf:data.pdf||null,spreadsheet:data.spreadsheet||null,wordDocument:selectedCsv?.kind==="word-document"?{name:selectedCsv.name,paragraphCount:selectedCsv.paragraphCount,truncated:selectedCsv.truncated}:null});chat.updated=Date.now();
    if(stillActive()){$("typing")?.remove();appendMessage("assistant",data.response,true,{regenerate:true,responseId:data.saved?data.responseId:null,conversationId:data.saved?data.conversationId:null});addEditActionToLastUser();appendSources(data.links);appendToolActivity(data.toolActivity);appendGoogleGrounding(data.googleGrounding);appendFormDraft(data.formDraft);if(data.pdf)appendPdfSource(data.pdf);if(data.spreadsheet)appendSpreadsheetSource(data.spreadsheet);if(data.presentation)appendPresentationSource(data.presentation);if(selectedCsv?.kind==="word-document")appendWordDocumentSource(selectedCsv);if(selectedCsv?.kind==="image-ocr")appendImageOcrSource(selectedCsv);renderWorkflow(data.steps)}
    if(state===AppState.AUTH&&data.saved&&data.conversationId){
      chat.serverId=data.conversationId;chat.id=data.conversationId;chat.loaded=true;
      if(stillActive()){activeId=chat.id;replaceRoute({name:"chat",id:chat.id})}
    }
    if(data.saveWarning)toast(data.saveWarning);
    else if(!stillActive())toast("Jawaban untuk \""+chat.title+"\" sudah siap");
    else toast("Selesai dalam "+((Date.now()-start)/1000).toFixed(1)+" detik");
    /* Server memperlakukan sesi kedaluwarsa sebagai guest (chat tetap jalan, tidak tersimpan): deteksi di sini. */
    if(state===AppState.AUTH&&!data.saved&&!data.saveWarning)verifySession();
  }catch(e){
    if(e.cancelled||e.name==="AbortError"){
      const at=chat.messages.indexOf(userEntry);if(at>=0)chat.messages.splice(at,1);
      if(replacing&&previousTurn){chat.messages.push(previousTurn.user,previousTurn.assistant);if(stillActive()){$("typing")?.remove();messagesEl.lastElementChild?.remove();appendMessage("user",previousTurn.user.content,true,{edit:true});appendMessage("assistant",previousTurn.assistant.content,true,{regenerate:true})}}
      else if(stillActive()){$("typing")?.remove();messagesEl.lastElementChild?.remove()}
      if(stillActive()){promptEl.value=text;resizePrompt();if(!activePdf&&!activeCsv){activePdf=selectedPdf;activeCsv=selectedCsv;if(sentPreviewUrl){attachmentThumbnailUrl=sentPreviewUrl;sentImageUrls=sentImageUrls.filter(url=>url!==sentPreviewUrl);}renderAttachmentPreview();}}
      toast("Generasi dihentikan.");
      return;
    }
    const message="Maaf, permintaan gagal diproses. "+(e.message||"Periksa koneksi lalu coba lagi.");
    const at=chat.messages.indexOf(userEntry);if(at>=0)chat.messages.splice(at,1); /* giliran gagal tidak disimpan */
    if(replacing&&previousTurn){
      pendingRetryRequest={text,requestId,conversationId:startId};
      chat.messages.push(previousTurn.user,previousTurn.assistant);
      if(stillActive()){
        $("typing")?.remove();messagesEl.lastElementChild?.remove();
        appendMessage("user",previousTurn.user.content,true,{edit:true});
        appendMessage("assistant",previousTurn.assistant.content,true,{regenerate:true});
      }
      promptEl.value=text;resizePrompt();toast(message);
    }else{
      if(stillActive()){$("typing")?.remove();appendFailedTurn(message,text,e.code==="daily_limit",requestId,{pdf:selectedPdf,csv:selectedCsv},sentPreviewUrl);if(e.data?.links?.length)appendSources(e.data.links)}
      toast("Permintaan gagal");
    }
  }finally{busy=false;activeChatController=null;lockComposer();renderHistory();if(!isDrawerMode())promptEl.focus()}
}
function addEditActionToLastUser(){
  const row=messagesEl.children[messagesEl.children.length-2];if(!row?.classList.contains("user"))return;
  const actions=row.querySelector(".message-actions");if(!actions||actions.querySelector(".edit-message"))return;
  if(row.querySelector(".sent-file-card"))return; // raw attachment bytes are never saved; cannot blindly re-edit
  const content=row.querySelector(".message-text")?.textContent||"";
  const btn=document.createElement("button");btn.type="button";btn.className="message-action edit-message";btn.textContent="Edit & kirim";
  btn.addEventListener("click",()=>replaceLastTurn("edit",content));actions.append(btn);
}
function replaceLastTurn(action,content){
  if(busy||loadingChat)return;
  const chat=conversations.find(c=>c.id===activeId);if(!chat||chat.messages.length<2)return;
  const assistant=chat.messages.at(-1),user=chat.messages.at(-2);
  if(user.role!=="user"||assistant.role!=="assistant")return;
  if(unpackAttachmentMessage(user.content).attachment){toast("Unggah ulang file untuk membuat ulang jawaban. Berkas asli tidak disimpan BOR AI.");return;}
  let nextText=user.content;
  if(action==="edit"){
    const edited=window.prompt("Edit pesan terakhir:",user.content);
    if(edited===null)return;
    nextText=edited.trim();
    if(!nextText){toast("Pesan tidak boleh kosong.");return}
    if(nextText.length>12000){toast("Pesan maksimal 12.000 karakter.");return}
  }
  const previousTurn={user:{...user},assistant:{...assistant}};
  chat.messages.splice(-2,2);
  messagesEl.lastElementChild?.remove();messagesEl.lastElementChild?.remove();
  promptEl.value=nextText;resizePrompt();
  submit({replaceLastTurn:true,previousTurn});
}
async function renameChat(cid){
  if(busy||loadingChat)return;
  const chat=conversations.find(c=>c.id===cid);if(!chat)return;
  const proposed=window.prompt("Masukkan judul percakapan (maks. 72 karakter):",chat.title||"");
  if(proposed===null)return;
  const title=proposed.trim();
  if(!title){toast("Judul tidak boleh kosong.");return}
  if(title.length>72){toast("Judul maksimal 72 karakter.");return}
  if(title===(chat.title||""))return;
  try{
    if(state===AppState.AUTH&&chat.serverId){
      const data=await api("/api/conversations/"+encodeURIComponent(chat.serverId),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({title})});
      chat.title=data.title||title;
    }else chat.title=title;
    renderHistory();toast("Judul chat diperbarui.");
  }catch(e){toast(e.message||"Gagal mengubah judul chat")}
}
async function pinChat(cid){
  if(busy||loadingChat)return;
  const chat=conversations.find(c=>c.id===cid);if(!chat)return;
  const pinned=!Boolean(chat.pinned);
  try{
    if(state===AppState.AUTH){
      if(!chat.serverId){toast("Kirim pesan terlebih dahulu agar chat tersimpan sebelum disematkan.");return}
      await api("/api/conversations/"+encodeURIComponent(chat.serverId),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({pinned})});
    }
    chat.pinned=pinned;renderHistory();toast(pinned?"Chat disematkan.":"Sematan chat dilepas.");
  }catch(e){toast(e.message||"Gagal mengubah sematan chat")}
}
async function archiveChat(cid){
  if(busy||loadingChat)return;
  const chat=conversations.find(c=>c.id===cid);if(!chat)return;
  const archived=!Boolean(chat.archived);
  try{
    if(state===AppState.AUTH){
      if(!chat.serverId){toast("Chat belum tersimpan di akun.");return}
      await api("/api/conversations/"+encodeURIComponent(chat.serverId),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({archived})});
    }
    chat.archived=archived;renderHistory();
    toast(archived?"Chat dipindahkan ke arsip.":"Chat dipulihkan dari arsip.");
  }catch(e){toast(e.message||"Gagal mengubah arsip chat")}
}
async function deleteChat(cid){
  if(busy)return;const chat=conversations.find(c=>c.id===cid);if(!chat)return;
  if(!confirm("Hapus percakapan ini?"))return;
  try{
    if(state===AppState.AUTH&&chat.serverId)await api("/api/conversations/"+encodeURIComponent(chat.serverId),{method:"DELETE"});
    conversations=conversations.filter(c=>c.id!==cid);
    if(activeId===cid){resetChatView();renderHistory();if(drawerOpen){commitRoute({name:"new"})}else replaceRoute({name:"new"})}else renderHistory();
    toast("Chat dihapus");
  }catch(e){toast(e.message||"Gagal menghapus chat")}
}
async function clearHistory(){
  if(busy||!conversations.length)return;if(!confirm("Hapus semua riwayat chat?"))return;
  try{
    if(state===AppState.AUTH)await api("/api/conversations",{method:"DELETE"});
    conversations=[];resetChatView();renderHistory();
    if(drawerOpen)commitRoute({name:"new"});else replaceRoute({name:"new"});
    toast("Semua riwayat dihapus");
  }catch(e){toast(e.message||"Gagal menghapus riwayat")}
}

/* ---------- 7. Boot ---------- */
async function boot(){
  setState(AppState.INIT);
  let me;
  try{me=await api("/api/auth/me")}
  catch{setState(AppState.ERROR,"Status akun tidak dapat diperiksa. Periksa koneksi lalu coba lagi, atau lanjutkan sebagai Guest.");loadGoogle();return}
  if(me.authenticated){currentUser=me.user;setState(AppState.AUTH);await enterChat();
    // Existing Google sessions skip the login button boot path. Resolve the
    // public OAuth client ID now so a later user-click can ask for Forms scope.
    try{const cfg=await api("/api/config");if(cfg.googleSignInEnabled&&cfg.googleClientId)gsi.clientId=cfg.googleClientId;}catch{}
    return}
  // The Free plan is an opt-in guest-chat link, not a payment or subscription route.
  // Keep a pre-existing signed-in session above; otherwise use the same Guest flow
  // as the welcome screen, with no checkout and no saved Guest chat content.
  if(new URLSearchParams(location.search).get("plan")==="free"){
    writeGuestFlag(true);currentUser=null;setState(AppState.GUEST);await enterChat();loadGoogle();return;
  }
  if(readGuestFlag()){setState(AppState.GUEST);await enterChat();loadGoogle();return}
  setState(AppState.UNAUTH);loadGoogle();
}
$("openEmailDraft")?.addEventListener("click",()=>{if(busy||loadingChat)return;$("emailDraftPanel").hidden=!$("emailDraftPanel").hidden;if(!$("emailDraftPanel").hidden)$("emailPurpose").focus()});
$("closeEmailDraft")?.addEventListener("click",()=>{$("emailDraftPanel").hidden=true});
$("prepareEmailDraft")?.addEventListener("click",()=>{const r=window.BOREmailDraft?.buildPrompt({recipient:$("emailRecipient").value,subject:$("emailSubject").value,purpose:$("emailPurpose").value,points:$("emailPoints").value,tone:$("emailTone").value,language:$("emailLanguage").value});if(!r?.ok){toast(r?.error||"Generator email tidak tersedia.");$("emailPurpose").focus();return;}promptEl.value=r.prompt;$("agent").value="writer";$("emailDraftPanel").hidden=true;resizePrompt();promptEl.focus();toast("Instruksi draft email siap. Periksa lalu tekan tombol kirim.");});
$("continueGuest").addEventListener("click",()=>{writeGuestFlag(true);currentUser=null;setState(AppState.GUEST);enterChat();loadGoogle()});
$("gateRetry").addEventListener("click",boot);
$("googleRetry").addEventListener("click",()=>loadGoogle(true));
$("chatForm").addEventListener("submit",e=>{e.preventDefault();submit()});
$("attachPdf").addEventListener("click",()=>{if(!busy&&!loadingChat)$("pdfFile").click()});
$("pdfFile").addEventListener("change",event=>{const file=event.target.files?.[0];event.target.value="";uploadAnyFile(file)});
$("clearPdf").addEventListener("click",()=>{clearSelectedAttachment();toast("Lampiran dilepas dari pesan.")});
$("attachCsv").addEventListener("click",()=>{if(!busy&&!loadingChat)$("csvFile").click()});
$("csvFile").addEventListener("change",event=>{const file=event.target.files?.[0];event.target.value="";uploadAnyFile(file)});
$("clearCsv").addEventListener("click",()=>{clearSelectedAttachment();toast("Lampiran dilepas dari pesan.")});
$("stopGeneration").addEventListener("click",()=>{if(busy)activeChatController?.abort()});
promptEl.addEventListener("input",resizePrompt);
/* Enter sengaja TIDAK mengirim: Enter = baris baru di semua perangkat. Satu-satunya cara kirim lewat UI adalah tombol panah. */
window.addEventListener("resize",resizePrompt);
window.visualViewport?.addEventListener("resize",resizePrompt);
$("newChat").addEventListener("click",newChat);
$("exportConversation").addEventListener("click",exportConversationFile);
$("printConversation").addEventListener("click",printConversation);
$("clearHistory").addEventListener("click",clearHistory);
$("toggleArchived").addEventListener("click",async()=>{
  if(busy||loadingChat)return;
  archivedView=!archivedView;
  if(state===AppState.AUTH){
    try{await syncUserHistory();renderHistory()}
    catch(e){archivedView=!archivedView;toast(e.message||"Gagal memuat arsip")}
  }else renderHistory();
});
$("historySearchForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const query=$("historySearch").value.trim().slice(0,100);
  if(state===AppState.AUTH){
    try{await syncUserHistory(query);renderHistory()}
    catch(err){toast(err.message||"Pencarian riwayat gagal")}
  }else{
    historyQuery=query;
    renderHistory();
  }
});
$("historySearch").addEventListener("keydown",e=>{
  if(e.key==="Escape"){
    e.preventDefault();$("historySearch").value="";
    if(state===AppState.AUTH)syncUserHistory("").then(renderHistory).catch(err=>toast(err.message||"Gagal memuat riwayat"));
    else{historyQuery="";renderHistory()}
  }
});
$("signOut").addEventListener("click",signOut);
$("githubConnect").addEventListener("click",connectGitHub);
$("githubDisconnect").addEventListener("click",disconnectGitHub);
$("openGithubRepos")?.addEventListener("click",openGitHubRepositories);
$("githubReposClose").addEventListener("click",()=>$("githubReposDialog").close());
$("githubReposRefresh").addEventListener("click",loadGitHubRepositories);
$("githubRepoSearch").addEventListener("input",renderGitHubRepositories);
$("githubRepoVisibility").addEventListener("change",renderGitHubRepositories);
$("githubReposDialog").addEventListener("click",event=>{const dialog=$("githubReposDialog");if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close()});
function restoreAccountAfterChildDialog(){
  if(!returnToAccountOnChildClose)return;
  returnToAccountOnChildClose=false;
  if(history.state?.overlay==="account"&&state===AppState.AUTH&&currentUser&&!accountDialog.open){
    accountDialog.showModal();accountView("home");
  }
}
const pluginsDialog=$("pluginsDialog");
let githubChatToolsEnabled=false;
function pluginText(value){return window.BORLocale?.translate?.(value)||value}
async function refreshPluginCapabilities(){
  const searchStatus=$("pluginSearchStatus"),searchMeta=$("pluginSearchMeta");
  const imageStatus=$("pluginImagesStatus"),imageButton=$("pluginImagesUse"),imageGalleryButton=$("pluginImagesGallery");
  searchStatus.textContent=pluginText("Checking availability…");
  imageStatus.textContent=pluginText("Checking availability…");
  imageButton.disabled=true;
  try{
    const data=await api("/api/plugins/capabilities");
    githubChatToolsEnabled=Boolean(data?.tools?.github?.inChatActions);
    const searchConfigured=Boolean(data?.tools?.webSearch?.available);
    searchStatus.textContent=pluginText(searchConfigured?"Automatic · Configured":"Not configured");
    searchMeta.textContent=pluginText(searchConfigured?"Live search provider is configured; search runs only when current facts are needed.":"Live web search is unavailable. BOR AI will not claim it searched the web.");
    const imagesAvailable=Boolean(data?.tools?.imageGeneration?.available);
    imageStatus.textContent=pluginText(imagesAvailable?"Available":"Not available");
    imageButton.disabled=!imagesAvailable;
    imageButton.textContent=pluginText(imagesAvailable?"Open image tools":"Image generation unavailable");
    imageGalleryButton.hidden=!imagesAvailable||state!==AppState.AUTH;
  }catch{
    githubChatToolsEnabled=false;
    searchStatus.textContent=pluginText("Status unavailable");
    searchMeta.textContent=pluginText("Could not check live search configuration.");
    imageStatus.textContent=pluginText("Status unavailable");
    imageButton.disabled=true;
    imageButton.textContent=pluginText("Image generation unavailable");
    imageGalleryButton.hidden=true;
  }
}
$("openPlugins").addEventListener("click",()=>{
  if(drawerOpen)closeDrawerDom(false);
  if(!pluginsDialog.open)pluginsDialog.showModal();
  refreshPluginCapabilities().then(()=>{if(state===AppState.AUTH)refreshGitHubConnection();else resetGitHubConnection()});
  $("pluginsClose").focus();
});
$("pluginsClose").addEventListener("click",()=>pluginsDialog.close());
pluginsDialog.addEventListener("click",event=>{if(event.target!==pluginsDialog)return;const rect=pluginsDialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)pluginsDialog.close()});
$("pluginSearch").addEventListener("input",()=>{
  const query=$("pluginSearch").value.trim().toLowerCase();
  document.querySelectorAll("#pluginCatalog [data-plugin-card]").forEach(card=>{card.hidden=!card.textContent.toLowerCase().includes(query)});
});
$("pluginFilesUse").addEventListener("click",()=>{pluginsDialog.close();$("pdfFile").click()});
$("pluginImagesUse").addEventListener("click",()=>{pluginsDialog.close();$("toolsMenu").open=true;$("imageTask").focus()});
$("pluginImagesGallery").addEventListener("click",()=>{pluginsDialog.close();openImageGallery()});
$("pluginEmailUse").addEventListener("click",()=>{pluginsDialog.close();$("emailDraftPanel").hidden=false;$("emailPurpose").focus()});
pluginsDialog.addEventListener("close",()=>{$("pluginSearch").value="";document.querySelectorAll("#pluginCatalog [data-plugin-card]").forEach(card=>card.hidden=false)});
const aboutDialog=$("aboutDialog");
$("about").addEventListener("click",()=>{
  if(!aboutDialog.open)aboutDialog.showModal();
  $("aboutClose").focus();
});
$("aboutClose").addEventListener("click",()=>aboutDialog.close());
aboutDialog.addEventListener("click",event=>{
  if(event.target!==aboutDialog)return;
  const rect=aboutDialog.getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)aboutDialog.close();
});
aboutDialog.addEventListener("close",restoreAccountAfterChildDialog);
document.querySelectorAll("[data-prompt]").forEach(b=>b.addEventListener("click",()=>{promptEl.value=b.dataset.prompt;resizePrompt();promptEl.focus()}));
history.scrollRestoration="manual";
syncInert();health();boot();

// Image jobs live independently from text history and survive reloads in Gambar saya.
let pendingImageRequest=null;
let imageFollowupSource=null;
const imageJobsWatching=new Set();
const imageSleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function originalImageData(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Foto gagal dibaca.'));reader.readAsDataURL(file);});}
async function prepareImageRequest(text,mode,attachment){
  if(state!==AppState.AUTH){toast('Masuk dengan akun Google untuk membuat atau mengedit gambar.');return;}
  if(mode==='edit'&&!attachment?.originalFile&&!imageFollowupSource){toast('Unggah foto atau pilih Edit lagi pada hasil gambar.');return;}
  try{
    const config=await api('/api/images/config');
    if(!config.enabled){toast('Fitur buat/edit gambar belum aktif di BOR AI saat ini.');return;}
    pendingImageRequest={text,mode,tariffVersion:config.tariffVersion,maxCredits:config.credits[mode],file:attachment?.originalFile||null,sourceJobId:attachment?null:imageFollowupSource,requestId:crypto.randomUUID()};
    $('imageQuote').textContent='Biaya: '+config.credits[mode]+' kredit gambar · tarif '+config.tariffVersion+'. Kredit dikembalikan jika job gagal.';
    $('imageSourceNotice').textContent=mode==='edit'?'Sumber: '+(attachment?.name||'hasil gambar sebelumnya'):'';
    $('imageGallery').replaceChildren();$('imageConfirm').hidden=false;$('imageConfirm').disabled=false;
    $('imageDialog').showModal();
  }catch(error){toast(error.message);}
}
function imageResultCard(job){
  const card=document.createElement('section');card.className='image-result';card.dataset.jobId=job.id;
  const title=document.createElement('p');title.textContent=job.prompt;card.append(title);
  const status=document.createElement('p');status.setAttribute('role','status');
  const statuses={queued:'Mengantre…',processing:'Membuat gambar…',completed:'Selesai',failed:'Gagal · kredit dikembalikan',expired:'File sudah kedaluwarsa'};
  status.textContent=statuses[job.status]||job.status;card.append(status);
  if(job.errorCode){const error=document.createElement('p');error.textContent='Kode: '+job.errorCode;card.append(error);}
  const file=job.files?.[0];
  if(file){
    // Derive authenticated same-origin URLs; never render arbitrary provider URLs.
    const img=document.createElement('img');img.src='/api/files/'+job.id+'/preview';img.alt=job.prompt.slice(0,180);img.loading='lazy';card.append(img);
    const info=document.createElement('p');info.textContent=file.mimeType+' · '+Math.ceil(file.size/1024)+' KB · '+job.credits+' kredit · tersedia sampai '+new Date(job.expiresAt*1000).toLocaleDateString();card.append(info);
    const download=document.createElement('a');download.href='/api/files/'+job.id+'/download';download.textContent='Download';download.className='message-action';download.download=file.name;card.append(download);
    for(const [label,mode,prompt] of [['Edit lagi','edit',''],['Buat variasi','edit','Buat variasi dari gambar ini. '+job.prompt],['Buat ulang','generate',job.prompt]]){
      const button=document.createElement('button');button.type='button';button.className='message-action';button.textContent=label;
      button.addEventListener('click',()=>{$('imageDialog').close();imageFollowupSource=mode==='edit'?job.id:null;$('imageTask').value=mode;promptEl.value=prompt;resizePrompt();promptEl.focus();toast('Tulis instruksi, lalu kirim untuk melihat biaya.');});card.append(button);
    }
  }
  if(!['queued','processing','expired'].includes(job.status)){
    const remove=document.createElement('button');remove.type='button';remove.textContent='Hapus gambar';remove.className='message-action';
    remove.addEventListener('click',async()=>{remove.disabled=true;try{await api('/api/images/jobs/'+job.id,{method:'DELETE'});card.remove();}catch(error){toast(error.message);remove.disabled=false;}});card.append(remove);
  }
  return card;
}
function updateImageCards(job){for(const card of document.querySelectorAll('.image-result'))if(card.dataset.jobId===job.id)card.replaceWith(imageResultCard(job));}
async function watchImageJob(job){
  if(imageJobsWatching.has(job.id)||!['queued','processing'].includes(job.status))return;
  imageJobsWatching.add(job.id);
  try{
    // Stop polling after 4 minutes; server processing continues. Gallery resumes status checks.
    for(let i=0;i<80;i++){await imageSleep(3000);const next=await api('/api/images/jobs/'+job.id);updateImageCards(next);if(!['queued','processing'].includes(next.status))break;}
  }catch(error){toast(error.message);}finally{imageJobsWatching.delete(job.id);}
}
$('imageClose').addEventListener('click',()=>$('imageDialog').close());
$('imageDialog').addEventListener('close',()=>{pendingImageRequest=null;});
$('imageConfirm').addEventListener('click',async()=>{
  const pending=pendingImageRequest;if(!pending)return;
  $('imageConfirm').disabled=true;
  $('imageQuote').textContent='Mengunggah dan mengantrekan gambar…';
  try{
    const sourceImage=pending.file?await originalImageData(pending.file):undefined;
    const job=await postJson('/api/images/jobs',{requestId:pending.requestId,prompt:pending.text,mode:pending.mode,tariffVersion:pending.tariffVersion,maxCredits:pending.maxCredits,sourceImage,sourceJobId:pending.sourceJobId||undefined,size:$('imageSize').value,outputFormat:$('imageFormat').value},30000);
    $('imageDialog').close();promptEl.value='';resizePrompt();clearSelectedAttachment();imageFollowupSource=null;$('imageTask').value='auto';
    welcomeEl.hidden=true;messagesEl.hidden=false;messagesEl.append(imageResultCard(job));watchImageJob(job);
  }catch(error){$('imageQuote').textContent=error.message+' Jika mengulang, gunakan tombol ini agar job tidak ditagih dua kali.';$('imageConfirm').disabled=false;}
});
async function openImageGallery(){
  if(state!==AppState.AUTH){toast('Masuk untuk membuka gambar Anda.');return;}
  $('imageConfirm').hidden=true;$('imageQuote').textContent='Memuat gambar…';$('imageGallery').replaceChildren();$('imageDialog').showModal();$('toolsMenu').open=false;
  try{const data=await api('/api/images/jobs');$('imageQuote').textContent='Saldo: '+data.balance+' kredit gambar · '+data.jobs.length+' job terbaru';for(const job of data.jobs){$('imageGallery').append(imageResultCard(job));watchImageJob(job);}}
  catch(error){$('imageQuote').textContent=error.message;}
}
$('openImageGallery')?.addEventListener('click',openImageGallery);
