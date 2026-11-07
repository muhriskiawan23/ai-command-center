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
    let src = String(input || "").replace(/\r\n?/g, "\n");
    const blocks = [];
    src = src.replace(/```([\w+-]*)[ \t]*\n([\s\S]*?)```/g, (_, lang, code) => {
      const key = "@@CB" + blocks.length + "@@";
      blocks.push({ lang, code });
      return key;
    });
    src = src
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n\n+/g, "\n")
      .replace(/^(#+)\s+(.*)$/gm, (_, hash, text) => `<h${hash.length}>${text}</h${hash.length}>`)
      .replace(/^>\s*(.*)$/gm, "<blockquote>$1</blockquote>")
      .replace(/^(?:- |\* |\+ )(.*)$/gm, "<li>$1</li>")
      .replace(/\n<li>/g, "\n<ul>\n<li>")
      .replace(/<\/li>\n(?!<li>|<h|<p|<blockquote|<ul|<ol)/g, "</li>\n</ul>\n")
      .replace(/\n(?!<)/g, "<br>\n");

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const tag = block.lang ? ` class="language-${escapeHTML(block.lang)}"` : "";
      src = src.replace("@@CB" + i + "@@", `<pre><code${tag}>${escapeHTML(block.code)}</code></pre>`);
    }

    return src;
  }


  function appendMessage(role,content,scroll=true,controls={}) {
    const row=document.createElement("article");row.className="message "+role;
    const avatar=document.createElement("div");avatar.className="avatar";avatar.textContent=role==="assistant"?"✳":"";
    const body=document.createElement("div");body.className="message-body";
    const rendered=document.createElement("div");rendered.className="message-text";rendered.innerHTML=markdown(content);body.append(rendered);
    const actions=document.createElement("div");actions.className="message-actions";
    const copyBtn=document.createElement("button");copyBtn.type="button";copyBtn.className="message-action";copyBtn.textContent="Salin";copyBtn.addEventListener("click",()=>copyText(content));
    const markdownBtn=document.createElement("button");markdownBtn.type="button";markdownBtn.className="message-action";markdownBtn.textContent="Markdown";markdownBtn.addEventListener("click",()=>downloadMarkdown(content,role));
    const plainBtn=document.createElement("button");plainBtn.type="button";plainBtn.className="message-action";plainBtn.textContent="Teks";plainBtn.addEventListener("click",()=>downloadText(content,role));const printBtn=document.createElement("button");printBtn.type="button";printBtn.className="message-action print-message";printBtn.textContent="PDF / Cetak";printBtn.addEventListener("click",()=>printMessage(content,role));actions.append(copyBtn,markdownBtn,plainBtn,printBtn);
    if(role==="assistant"){
      const checklistBtn=document.createElement("button");checklistBtn.type="button";checklistBtn.className="message-action checklist-action";checklistBtn.textContent="Checklist";
      checklistBtn.addEventListener("click",()=>showChecklistExport(content,actions));actions.append(checklistBtn);
    }
    if(controls.edit){const editBtn=document.createElement("button");editBtn.type="button";editBtn.className="message-action edit-message";editBtn.textContent="Edit & kirim";editBtn.addEventListener("click",()=>replaceLastTurn("edit",content));actions.append(editBtn)}
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
  promptEl.style.height="auto";
  const max=parseFloat(getComputedStyle(promptEl).maxHeight)||220;
  const needed=promptEl.scrollHeight;
  promptEl.style.height=Math.min(needed,max)+"px";
  promptEl.style.overflowY=needed>max?"auto":"hidden";
}
async function health(){try{const r=await fetch(API+"/api/health");if(!r.ok)throw Error();const d=await r.json();$("healthDot").className="dot "+(d.ok?"ok":"bad");$("healthText").textContent=d.ok?["Layanan aktif","Terhubung ke BOR AI"]:["Layanan tidak aktif","Status tidak siap"];$("healthDot").title=d.ok?"Layanan aktif":"Layanan gagal";}catch{const dot=$("healthDot");dot.className="dot bad";dot.title="Layanan tidak dapat dicek";$("healthText").textContent="Status tidak siap";}}

const CHAT_TIMEOUT_MS=150000; /* alur multi-agent bisa beberapa panggilan model berurutan; lewat ini dianggap macet */
let activeChatController=null;
let pendingRetryRequest=null;
async function api(path,opts={}){
  const {timeoutMs,...fetchOpts}=opts;let res,timer,timedOut=false;
  const externalSignal=fetchOpts.signal;
  const ctrl=timeoutMs?new AbortController():null;
  if(ctrl){fetchOpts.signal=externalSignal?AbortSignal.any([externalSignal,ctrl.signal]):ctrl.signal;timer=setTimeout(()=>{timedOut=true;ctrl.abort()},timeoutMs)}
  try{res=await fetch(API+path,{credentials:"same-origin",...fetchOpts})}
  catch(error){
    if(externalSignal?.aborted)throw Object.assign(new Error("Generasi dihentikan."),{name:"AbortError",cancelled:true,status:0});
    throw Object.assign(new Error(timedOut?"Server terlalu lama merespons (lebih dari "+Math.round(timeoutMs/1000)+" detik). Coba lagi.":"Tidak dapat terhubung ke server. Periksa koneksi Anda."),{status:0});
  }finally{clearTimeout(timer)}
  let data=null;try{data=await res.json()}catch{}
  if(!res.ok){
    const err=new Error((data&&data.error)||"HTTP "+res.status);err.status=res.status;err.code=data&&data.code;err.data=data;
    if(res.status===401&&state===AppState.AUTH)expireSession();
    throw err;
  }
  return data||{};
}
const postJson=(path,body,timeoutMs,signal)=>api(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),timeoutMs,signal});
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
let state=AppState.INIT,conversations=[],activeId=null,busy=false,currentUser=null,historyQuery="",archivedView=false,activePdf=null,activeCsv=null;
let historyCursor=null,historyHasMore=false,historyLoadingMore=false,historyRequestSeq=0;
/* navSeq: setiap navigasi chat menaikkan penghitung ini; pemuatan yang tertimpa navigasi lebih baru dibatalkan. */
let navSeq=0,loadingChat=false;
function lockComposer(){const lock=busy||loadingChat;const send=$("send"),stop=$("stopGeneration");send.disabled=lock;send.hidden=busy;stop.hidden=!busy;stop.disabled=!busy;promptEl.readOnly=lock;$("exportConversation").disabled=lock;$("printConversation").disabled=lock;$("attachPdf").disabled=lock;$("attachCsv").disabled=lock;}

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
  navSeq++;loadingChat=false;activePdf=null;activeCsv=null;renderPdfAttachment();renderCsvAttachment();lockComposer();
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

function renderAuth(){
  const logged=state===AppState.AUTH&&Boolean(currentUser);
  $("authTitle").textContent=logged?"Masuk sebagai":"Guest Mode";
  $("authDescription").textContent=logged?(currentUser.email||"Riwayat chat tersimpan di akun Google."):"Chat guest hanya ada di halaman ini dan hilang saat dimuat ulang. Masuk dengan Google untuk menyimpan riwayat permanen.";
  $("googleButton").hidden=logged;$("userProfile").hidden=!logged;$("signOut").hidden=!logged;
  $("googleSideStatus").hidden=logged||!$("googleSideStatus").textContent;
  $("userProfile").replaceChildren();
  if(logged){
    const wrap=document.createElement("div");wrap.className="auth-user";
    if(currentUser.picture){const img=document.createElement("img");img.src=currentUser.picture;img.alt="";wrap.append(img)}
    const info=document.createElement("div");info.className="auth-user-info";
    const name=document.createElement("strong");name.textContent=currentUser.name||"Akun Google";
    const email=document.createElement("small");email.textContent=currentUser.email||"";
    info.append(name,email);wrap.append(info);$("userProfile").append(wrap);
  }
  renderHistory();
  if(logged) refreshGitHubConnection(); else resetGitHubConnection();
}

let githubConnection=null;
let githubConnectionLoading=false;
let githubConnectionRequest=0;
function resetGitHubConnection(){
  githubConnection=null;githubConnectionLoading=false;githubConnectionRequest++;
  $("githubConnectionStatus").textContent="Perlu login Google";
  $("githubConnectionMessage").textContent="Masuk ke BOR AI terlebih dahulu untuk menghubungkan akun GitHub.";
  $("githubStatusDot").className="github-status-dot";
  $("githubConnect").textContent="Masuk dengan Google";$("githubConnect").disabled=false;$("githubConnect").hidden=false;$("githubDisconnect").hidden=true;
}
async function refreshGitHubConnection(){
  if(state!==AppState.AUTH||!currentUser)return;
  const request=++githubConnectionRequest;githubConnectionLoading=true;
  $("githubConnectionStatus").textContent="Memeriksa koneksi…";$("githubConnect").disabled=true;
  try{
    const data=await api("/api/github/connection");
    if(request!==githubConnectionRequest||state!==AppState.AUTH)return;
    githubConnection=Boolean(data.connected);
    $("githubConnectionStatus").textContent=githubConnection?"Terhubung"+(data.account?.login?" · @"+data.account.login:""):"Belum terhubung";
    $("githubConnectionMessage").textContent=githubConnection?"Akun GitHub siap digunakan. Akses repository tetap mengikuti izin GitHub App yang kamu berikan.":"Hubungkan akun GitHub untuk membaca repository dan mengelola perubahan setelah mendapat izinmu.";
    $("githubStatusDot").className="github-status-dot "+(githubConnection?"is-connected":"");
    $("githubConnect").textContent=githubConnection?"Hubungkan akun lain":"Hubungkan akun GitHub";
    $("githubDisconnect").hidden=!githubConnection;
  }catch(error){
    if(request!==githubConnectionRequest)return;
    $("githubConnectionStatus").textContent="Status belum dapat diperiksa";
    $("githubConnectionMessage").textContent=error.message||"Gagal memeriksa koneksi GitHub.";
    $("githubStatusDot").className="github-status-dot has-error";
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
  try{await api("/api/github/disconnect",{method:"POST"});toast("Koneksi GitHub diputuskan.");await refreshGitHubConnection()}
  catch(error){toast(error.message||"Gagal memutuskan koneksi GitHub.")}
  finally{githubConnectionLoading=false;$("githubDisconnect").disabled=false}
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
  if(memoryOpen&&s?.overlay!=="memory"){closeMemoryDom();return}              /* prioritas 1: Back menutup panel Memori */
  if(s?.overlay==="memory"){if(state===AppState.AUTH&&!memoryOpen)openMemoryDom();return}
  if(drawerOpen&&s?.overlay!=="drawer"){closeDrawerDom();return}           /* prioritas 2: Back menutup drawer */
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
  $("toggleArchived").textContent=archivedView?"▤ Lihat riwayat":"▣ Lihat arsip";
  $("toggleArchived").setAttribute("aria-pressed",String(archivedView));
  const query=historyQuery.toLocaleLowerCase();
  const visible=sortedConversations().filter(c=>Boolean(c.archived)===archivedView&&(!query||String(c.title||"").toLocaleLowerCase().includes(query)||(state===AppState.GUEST&&c.messages.some(m=>String(m.content||"").toLocaleLowerCase().includes(query)))));
  for(const c of visible){
    const row=document.createElement("div");row.className="history-row";
    const b=document.createElement("button");b.className="history-item"+(c.id===activeId?" active":"");b.type="button";
    if(c.id===activeId)b.setAttribute("aria-current","page");
    const icon=document.createElement("span");icon.textContent="▤";icon.setAttribute("aria-hidden","true");
    const title=document.createElement("span");title.textContent=c.title||"Percakapan baru";
    b.append(icon,title);b.title=c.title||"Percakapan baru";b.onclick=()=>selectChat(c.id);
    const pin=document.createElement("button");pin.className="pin-chat";pin.type="button";pin.textContent=c.pinned?"★":"☆";pin.title=c.pinned?"Lepas sematan":"Sematkan";pin.setAttribute("aria-label",(c.pinned?"Lepas sematan ":"Sematkan ")+(c.title||"chat"));pin.setAttribute("aria-pressed",String(Boolean(c.pinned)));pin.onclick=e=>{e.stopPropagation();pinChat(c.id)};
    const archive=document.createElement("button");archive.className="archive-chat";archive.type="button";archive.textContent=archivedView?"↩":"▣";archive.title=archivedView?"Pulihkan dari arsip":"Arsipkan";archive.setAttribute("aria-label",(archivedView?"Pulihkan dari arsip ":"Arsipkan ")+(c.title||"chat"));archive.onclick=e=>{e.stopPropagation();archiveChat(c.id)};
    const rename=document.createElement("button");rename.className="rename-chat";rename.type="button";rename.textContent="✎";rename.title="Ubah judul";rename.setAttribute("aria-label","Ubah judul "+(c.title||"chat"));
    rename.onclick=e=>{e.stopPropagation();renameChat(c.id)};
    const del=document.createElement("button");del.className="delete-chat";del.type="button";del.textContent="×";del.title="Hapus chat";del.setAttribute("aria-label","Hapus "+(c.title||"chat"));
    del.onclick=e=>{e.stopPropagation();deleteChat(c.id)};
    row.append(b,pin,archive,rename,del);nav.append(row);
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
  activePdf=null;activeCsv=null;renderPdfAttachment();renderCsvAttachment();activeId=cid;$("exportConversation").hidden=false;$("printConversation").hidden=false;welcomeEl.hidden=true;messagesEl.hidden=false;messagesEl.replaceChildren();
  for(let i=0;i<c.messages.length;i++){const m=c.messages[i];const last=i===c.messages.length-1;const previous=i===c.messages.length-2;appendMessage(m.role,m.content,false,{edit:m.role==="user"&&previous&&c.messages.at(-1)?.role==="assistant",regenerate:m.role==="assistant"&&last&&c.messages.at(-2)?.role==="user",responseId:m.role==="assistant"?m.id:null,conversationId:c.serverId||c.id,feedback:m.feedback||null});if(m.role==="assistant"&&m.links?.length)appendSources(m.links);if(m.role==="assistant"&&m.pdf)appendPdfSource(m.pdf);if(m.role==="assistant"&&m.spreadsheet)appendSpreadsheetSource(m.spreadsheet);}
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
  const head=document.createElement("strong");head.textContent="Sumber yang dibaca:";box.append(head);
  for(const l of links){
    const item=document.createElement("div");item.className="source "+(l.ok?"ok":"fail");
    if(l.ok){
      item.append(document.createTextNode("✓ ["+l.sourceId+"] "));
      if(typeof l.url==="string"&&/^https?:\/\//i.test(l.url)){
        const link=document.createElement("a");link.href=l.url;link.target="_blank";link.rel="noopener noreferrer";
        link.textContent=l.url+(l.title?" — "+l.title:"");item.append(link);
        if(l.resolvedUrl&&l.resolvedUrl!==l.url){const redirect=document.createElement("small");redirect.textContent="Dialihkan ke "+l.resolvedUrl;item.append(redirect);}
      }else item.append(document.createTextNode(l.host+(l.title?" — "+l.title:"")));
      if(l.truncated)item.append(document.createTextNode(" (dipotong)"));
    }else item.textContent="✗ "+(l.host||"tautan")+" — "+l.reason;
    box.append(item);
  }
  body.append(box);
}
function appendPdfSource(pdf){
  const row=messagesEl.lastElementChild;const body=row&&row.querySelector(".message-body");if(!body||!pdf)return;
  const box=document.createElement("div");box.className="sources pdf-source";
  const head=document.createElement("strong");head.textContent="Dokumen PDF yang dibaca:";box.append(head);
  const item=document.createElement("div");item.className="source ok";
  item.textContent="✓ "+String(pdf.name||"document.pdf")+(pdf.pageCount?" · "+pdf.pageCount+" halaman":" · jumlah halaman tidak terdeteksi")+(pdf.truncated?" · teks dipotong untuk batas konteks":"");
  box.append(item);body.append(box);
}
function renderPdfAttachment(){
  const wrap=$("pdfAttachment"),name=$("pdfName");if(!wrap||!name)return;
  wrap.hidden=!activePdf;name.textContent=activePdf?activePdf.name+" · PDF siap":"";
  $("attachPdf").textContent=activePdf?"Ganti PDF":"＋ PDF";
}
function appendSpreadsheetSource(spreadsheet){
  const row=messagesEl.lastElementChild;const body=row&&row.querySelector(".message-body");if(!body||!spreadsheet)return;
  const box=document.createElement("div");box.className="sources csv-source";
  const head=document.createElement("strong");head.textContent="Spreadsheet yang dianalisis:";box.append(head);
  const item=document.createElement("div");item.className="source ok";
  item.textContent="✓ "+String(spreadsheet.name||"spreadsheet.csv")+(Number.isSafeInteger(spreadsheet.rowCount)?" · "+spreadsheet.rowCount.toLocaleString("id-ID")+" baris":"")+(Number.isSafeInteger(spreadsheet.columnCount)?" · "+spreadsheet.columnCount+" kolom":"")+(spreadsheet.truncated?" · ringkasan dibatasi":"");
  box.append(item);body.append(box);
}
function appendPresentationSource(p){const row=messagesEl.lastElementChild,body=row&&row.querySelector(".message-body");if(!body||!p)return;const box=document.createElement("div");box.className="sources presentation-source";const h=document.createElement("strong");h.textContent="Presentasi yang dianalisis:";const item=document.createElement("div");item.className="source ok";item.textContent="✓ "+String(p.name||"presentation.pptx")+(Number.isSafeInteger(p.slideCount)?" · "+p.slideCount+" slide":"")+(p.truncated?" · teks dibatasi":"");box.append(h,item);body.append(box)}
function renderCsvAttachment(){
  const wrap=$("csvAttachment"),name=$("csvName");if(!wrap||!name)return;
  wrap.hidden=!activeCsv;const filename=activeCsv?.name||"",isPptx=/\.pptx$/i.test(filename),isExcel=/\.xlsx$/i.test(filename);name.textContent=activeCsv?filename+(isPptx?" · PowerPoint siap":isExcel?" · Excel siap":" · CSV siap"):"";
  $("attachCsv").textContent=activeCsv?(isPptx?"Ganti PowerPoint":isExcel?"Ganti Excel":"Ganti CSV"):"＋ CSV / Excel / PPTX";
}
async function uploadPdf(file){
  if(!file)return;
  if(!file.name.toLowerCase().endsWith(".pdf")){toast("Pilih file PDF (.pdf).");return;}
  if(file.size>8*1024*1024){toast("Ukuran PDF maksimal 8 MB.");return;}
  if(file.size<8){toast("File PDF tidak valid.");return;}
  const button=$("attachPdf");button.disabled=true;button.textContent="Membaca…";
  try{
    const {extractPdfLocally}=await import("/pdf-ocr.js");
    activeCsv=null;renderCsvAttachment();
    activePdf=await extractPdfLocally(file,{
      pdfjs:window.pdfjsLib,
      tesseract:window.Tesseract,
      onProgress:({status,page,total})=>{
        if(status==="loading-language")button.textContent="Unduh model OCR…";
        else if(status==="recognizing")button.textContent="OCR halaman "+page+"/"+total+"…";
        else if(status==="rendering")button.textContent="Render halaman "+page+"/"+total+"…";
        else button.textContent="Memproses PDF…";
      }
    });
    renderPdfAttachment();
    toast(activePdf.ocr?"OCR lokal selesai. Teks PDF siap dianalisis.":"PDF berhasil dibaca secara lokal. Tanyakan isinya di kolom chat.");
  }catch(error){toast(error.message||"PDF gagal dibaca.");}
  finally{button.disabled=busy||loadingChat;renderPdfAttachment()}
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
async function uploadCsv(file){
  if(!file)return;
  const filename=file.name.toLowerCase(),isExcel=filename.endsWith(".xlsx"),isPptx=filename.endsWith(".pptx");
  if(!isExcel&&!isPptx&&!filename.endsWith(".csv")){toast("Pilih file CSV, Excel (.xlsx), atau PowerPoint (.pptx).");return;}
  if(file.size>5*1024*1024){toast("Ukuran file maksimal 5 MB.");return;}
  if(file.size<1){toast("File kosong.");return;}
  const button=$("attachCsv");button.disabled=true;button.textContent="Membaca…";
  try{
    let parsed;
    if(isPptx){const jszip=await ensurePptxLibrary();const {parsePptxLocally}=await import("/pptx-reader.js");parsed=await parsePptxLocally(file,{jszip});parsed.kind="presentation";}
    else if(isExcel){const xlsx=await ensureXlsxLibrary();const {parseXlsxLocally}=await import("/xlsx-reader.js");parsed=await parseXlsxLocally(file,{xlsx});}
    else{const {parseCsvLocally}=await import("/csv-reader.js");parsed=await parseCsvLocally(file);}
    activePdf=null;renderPdfAttachment();activeCsv=parsed;renderCsvAttachment();
    toast(isPptx?"PowerPoint berhasil dibaca secara lokal. Tanyakan isi slide di kolom chat.":isExcel?"Excel berhasil dibaca secara lokal. Tanyakan analisisnya di kolom chat.":"CSV berhasil dibaca secara lokal. Tanyakan analisisnya di kolom chat.");
  }catch(error){toast(error.message||"File gagal dibaca.");}
  finally{button.disabled=busy||loadingChat;renderCsvAttachment()}
}
function appendFailedTurn(message,text,noRetry=false,requestId=null){
  appendMessage("assistant",message);
  const row=messagesEl.lastElementChild;const body=row&&row.querySelector(".message-body");if(!body)return;
  row.classList.add("failed");
  if(noRetry)return; /* batas harian: mencoba lagi sekarang percuma */
  const btn=document.createElement("button");btn.type="button";btn.className="retry-btn";btn.textContent="↻ Coba lagi";
  btn.addEventListener("click",()=>{
    if(busy||loadingChat)return;
    const prev=row.previousElementSibling;row.remove();if(prev&&prev.classList.contains("user"))prev.remove();
    promptEl.value=text;resizePrompt();submit({requestId});
  });
  body.append(btn);
}
async function submit(options={}){
  if(busy||loadingChat||!inChatView())return;const text=promptEl.value.trim();if(!text)return;
  const replacing=options.replaceLastTurn===true;const previousTurn=options.previousTurn||null;
  const requestId=options.requestId||(pendingRetryRequest?.text===text&&pendingRetryRequest.conversationId===activeId?pendingRetryRequest.requestId:crypto.randomUUID());
  busy=true;activeChatController=new AbortController();lockComposer();const agent=$("agent").value;
  let createdNew=false;
  if(!activeId){activeId=id();createdNew=true;conversations.push({id:activeId,serverId:null,title:text.replace(/\s+/g," ").slice(0,72),messages:[],updated:Date.now(),loaded:true})}
  const chat=conversations.find(c=>c.id===activeId);$("exportConversation").hidden=false;$("printConversation").hidden=false;const startId=chat.id;
  const history=buildHistory(chat);const userEntry={role:"user",content:text};chat.messages.push(userEntry);chat.updated=Date.now();
  welcomeEl.hidden=true;messagesEl.hidden=false;appendMessage("user",text);promptEl.value="";resizePrompt();showTyping();renderHistory();
  if(createdNew)replaceRoute({name:"chat",id:chat.id});
  const stillActive=()=>activeId===startId;const start=Date.now();
  try{
    const payload={message:text,agent,requestId};if(activePdf)payload.document={name:activePdf.name,content:activePdf.content,truncated:activePdf.truncated};if(activeCsv?.kind==="presentation")payload.presentation={name:activeCsv.name,content:activeCsv.content,slideCount:activeCsv.slideCount,truncated:activeCsv.truncated};else if(activeCsv)payload.spreadsheet={name:activeCsv.name,content:activeCsv.content,rowCount:activeCsv.rowCount,columnCount:activeCsv.columnCount,truncated:activeCsv.truncated};if(history.length)payload.history=history;if(state===AppState.AUTH&&chat.serverId)payload.conversationId=chat.serverId;if(replacing&&state===AppState.AUTH&&chat.serverId)payload.replaceLastTurn=true;
    const data=await postJson("/api/chat",payload,CHAT_TIMEOUT_MS,activeChatController.signal);
    if(typeof data.response!=="string"||!data.response.trim())throw new Error("AI tidak menghasilkan jawaban.");
    if(pendingRetryRequest?.requestId===requestId)pendingRetryRequest=null;
    chat.messages.push({role:"assistant",content:data.response,id:data.responseId||null,feedback:null,links:data.links||[],pdf:data.pdf||null,spreadsheet:data.spreadsheet||null});chat.updated=Date.now();
    if(stillActive()){$("typing")?.remove();appendMessage("assistant",data.response,true,{regenerate:true,responseId:data.saved?data.responseId:null,conversationId:data.saved?data.conversationId:null});addEditActionToLastUser();appendSources(data.links);if(data.pdf)appendPdfSource(data.pdf);if(data.spreadsheet)appendSpreadsheetSource(data.spreadsheet);if(data.presentation)appendPresentationSource(data.presentation);renderWorkflow(data.steps)}
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
      if(stillActive()){$("typing")?.remove();appendFailedTurn(message,text,e.code==="daily_limit",requestId);if(e.data?.links?.length)appendSources(e.data.links)}
      toast("Permintaan gagal");
    }
  }finally{busy=false;activeChatController=null;lockComposer();renderHistory();if(!isDrawerMode())promptEl.focus()}
}
function addEditActionToLastUser(){
  const row=messagesEl.children[messagesEl.children.length-2];if(!row?.classList.contains("user"))return;
  const actions=row.querySelector(".message-actions");if(!actions||actions.querySelector(".edit-message"))return;
  const content=row.querySelector(".message-text")?.textContent||"";
  const btn=document.createElement("button");btn.type="button";btn.className="message-action edit-message";btn.textContent="Edit & kirim";
  btn.addEventListener("click",()=>replaceLastTurn("edit",content));actions.append(btn);
}
function replaceLastTurn(action,content){
  if(busy||loadingChat)return;
  const chat=conversations.find(c=>c.id===activeId);if(!chat||chat.messages.length<2)return;
  const assistant=chat.messages.at(-1),user=chat.messages.at(-2);
  if(user.role!=="user"||assistant.role!=="assistant")return;
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
  if(me.authenticated){currentUser=me.user;setState(AppState.AUTH);await enterChat();return}
  if(readGuestFlag()){setState(AppState.GUEST);await enterChat();loadGoogle();return}
  setState(AppState.UNAUTH);loadGoogle();
}
$("openEmailDraft").addEventListener("click",()=>{if(busy||loadingChat)return;$("emailDraftPanel").hidden=!$("emailDraftPanel").hidden;if(!$("emailDraftPanel").hidden)$("emailPurpose").focus()});
$("closeEmailDraft").addEventListener("click",()=>{$("emailDraftPanel").hidden=true});
$("prepareEmailDraft").addEventListener("click",()=>{const r=window.BOREmailDraft?.buildPrompt({recipient:$("emailRecipient").value,subject:$("emailSubject").value,purpose:$("emailPurpose").value,points:$("emailPoints").value,tone:$("emailTone").value,language:$("emailLanguage").value});if(!r?.ok){toast(r?.error||"Generator email tidak tersedia.");$("emailPurpose").focus();return;}promptEl.value=r.prompt;$("agent").value="writer";$("emailDraftPanel").hidden=true;resizePrompt();promptEl.focus();toast("Instruksi draft email siap. Periksa lalu tekan tombol kirim.");});
$("continueGuest").addEventListener("click",()=>{writeGuestFlag(true);currentUser=null;setState(AppState.GUEST);enterChat();loadGoogle()});
$("gateRetry").addEventListener("click",boot);
$("googleRetry").addEventListener("click",()=>loadGoogle(true));
$("chatForm").addEventListener("submit",e=>{e.preventDefault();submit()});
$("attachPdf").addEventListener("click",()=>{if(!busy&&!loadingChat)$("pdfFile").click()});
$("pdfFile").addEventListener("change",event=>{const file=event.target.files?.[0];event.target.value="";uploadPdf(file)});
$("clearPdf").addEventListener("click",()=>{activePdf=null;renderPdfAttachment();toast("PDF dilepas dari chat.")});
$("attachCsv").addEventListener("click",()=>{if(!busy&&!loadingChat)$("csvFile").click()});
$("csvFile").addEventListener("change",event=>{const file=event.target.files?.[0];event.target.value="";uploadCsv(file)});
$("clearCsv").addEventListener("click",()=>{activeCsv=null;renderCsvAttachment();toast("CSV dilepas dari chat.")});
$("stopGeneration").addEventListener("click",()=>{if(busy)activeChatController?.abort()});
promptEl.addEventListener("input",resizePrompt);
/* Enter sengaja TIDAK mengirim: Enter = baris baru di semua perangkat. Satu-satunya cara kirim lewat UI adalah tombol panah. */
window.addEventListener("resize",resizePrompt);
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
document.querySelectorAll("[data-prompt]").forEach(b=>b.addEventListener("click",()=>{promptEl.value=b.dataset.prompt;resizePrompt();promptEl.focus()}));
history.scrollRestoration="manual";
syncInert();health();boot();
