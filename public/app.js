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
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function markdown(input){let src=String(input||"").replace(/\r\n?/g,"\n");const blocks=[];src=src.replace(/```([\w+-]*)[ \t]*\n([\s\S]*?)```/g,(_,lang,code)=>{const key="@@CB"+blocks.length+"@@";blocks.push("<pre><code>"+escapeHTML(code.replace(/\n$/,""))+"</code></pre>");return key});src=escapeHTML(src).replace(/`([^`\n]+)`/g,"<code>$1</code>").replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,"$1<em>$2</em>");const out=[];let p=[],list="",q=[];const fp=()=>{if(p.length){out.push("<p>"+p.join("<br>")+"</p>");p=[]}},fl=()=>{if(list){out.push("</"+list+">");list=""}},fq=()=>{if(q.length){out.push("<blockquote>"+q.join("<br>")+"</blockquote>");q=[]}};for(const line of src.split("\n")){const cb=line.match(/^@@CB(\d+)@@$/);if(cb){fp();fl();fq();out.push(blocks[+cb[1]]||"");continue}if(!line.trim()){fp();fl();fq();continue}const h=line.match(/^(#{1,3})\s+(.+)$/);if(h){fp();fl();fq();out.push("<h"+h[1].length+">"+h[2]+"</h"+h[1].length+">");continue}if(/^&gt;\s?/.test(line)){fp();fl();q.push(line.replace(/^&gt;\s?/,""));continue}else fq();const ul=line.match(/^\s*[-*+]\s+(.+)$/),ol=line.match(/^\s*\d+[.)]\s+(.+)$/);if(ul||ol){fp();const want=ul?"ul":"ol";if(list!==want){fl();out.push("<"+want+">");list=want}out.push("<li>"+(ul||ol)[1]+"</li>");continue}fl();p.push(line)}fp();fl();fq();return out.join("\n").replace(/@@CB(\d+)@@/g,(_,n)=>blocks[+n]||"")}
function appendMessage(role,content,scroll=true){const row=document.createElement("article");row.className="message "+role;const avatar=document.createElement("div");avatar.className="avatar";avatar.textContent=role==="user"?"B":"✳";const body=document.createElement("div");body.className="message-body";body.innerHTML=markdown(content);row.append(avatar,body);if(role==="assistant"){const actions=document.createElement("div");actions.className="message-actions";const copy=document.createElement("button");copy.className="tiny-btn";copy.textContent="Salin";copy.onclick=async()=>{try{await navigator.clipboard.writeText(content);toast("Jawaban disalin")}catch{toast("Gagal menyalin jawaban")}};actions.append(copy);body.append(actions)}messagesEl.append(row);if(scroll)conversation.scrollTop=conversation.scrollHeight;return row}
function showTyping(){const row=document.createElement("article");row.className="message assistant";row.id="typing";row.innerHTML='<div class="avatar">✳</div><div class="message-body"><span class="typing"><i></i><i></i><i></i></span> <span style="color:#aaa;font-size:12px">AI sedang berpikir…</span></div>';messagesEl.append(row);conversation.scrollTop=conversation.scrollHeight}
function renderWorkflow(steps){const items=$("workflowItems");items.replaceChildren();if(!Array.isArray(steps)||!steps.length){$("workflow").hidden=true;return}$("workflow").hidden=false;for(const s of steps){const d=document.createElement("details");d.className="workflow-step";const sum=document.createElement("summary");const title=document.createElement("span");title.textContent=s.agent||"Agent";const status=document.createElement("span");status.textContent=s.status==="completed"?"Selesai":s.status==="skipped"?"Dilewati":"Perlu diperiksa";sum.append(title,status);const text=document.createElement("div");text.className="step-text";text.textContent=s.output||"Tidak ada output";d.append(sum,text);items.append(d)}}
function resizePrompt(){promptEl.style.height="auto";promptEl.style.height=Math.min(promptEl.scrollHeight,220)+"px"}
async function health(){try{const r=await fetch(API+"/api/health");if(!r.ok)throw Error();const d=await r.json();$("healthDot").className="dot "+(d.ok?"ok":"bad");$("healthText").textContent=d.ok?"Layanan terhubung":"Layanan bermasalah"}catch{$("healthDot").className="dot bad";$("healthText").textContent="Tidak terhubung"}}

async function api(path,opts={}){
  let res;
  try{res=await fetch(API+path,{credentials:"same-origin",...opts})}
  catch{throw Object.assign(new Error("Tidak dapat terhubung ke server. Periksa koneksi Anda."),{status:0})}
  let data=null;try{data=await res.json()}catch{}
  if(!res.ok){
    const err=new Error((data&&data.error)||"HTTP "+res.status);err.status=res.status;
    if(res.status===401&&state===AppState.AUTH)expireSession();
    throw err;
  }
  return data||{};
}
const postJson=(path,body)=>api(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});

/* ---------- 2. State aplikasi ---------- */
const AppState={INIT:"initializing",UNAUTH:"unauthenticated",GUEST:"guest",AUTH:"authenticated",EXPIRED:"session-expired",ERROR:"error"};
const promptEl=$("prompt"),messagesEl=$("messages"),welcomeEl=$("welcome"),conversation=$("conversation");
const sidebar=$("sidebar"),backdrop=$("backdrop"),menuBtn=$("menuBtn"),workspace=$("workspace");
let state=AppState.INIT,conversations=[],activeId=null,busy=false,currentUser=null;
/* navSeq: setiap navigasi chat menaikkan penghitung ini; pemuatan yang tertimpa navigasi lebih baru dibatalkan. */
let navSeq=0,loadingChat=false;
function lockComposer(){const lock=busy||loadingChat;$("send").disabled=lock;promptEl.readOnly=lock}

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
  if(!inChatView())closeDrawerDom(false);
  syncInert();renderAuth();
}
function resetChatView(){
  navSeq++;loadingChat=false;lockComposer();
  activeId=null;messagesEl.replaceChildren();messagesEl.hidden=true;welcomeEl.hidden=false;
  $("workflow").hidden=true;promptEl.value="";resizePrompt();
}
function clearSessionData(){currentUser=null;conversations=[];resetChatView();renderHistory()}
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
  $("authDescription").textContent=logged?(currentUser.email||"Riwayat chat tersimpan di akun Google."):"Chat guest hanya ada di halaman ini dan hilang saat dimuat ulang. Masuk dengan Google untuk menyimpan riwayat baru; chat guest saat ini tidak dipindahkan ke akun.";
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
    if(!conversations.some(c=>c.id===cid))conversations.push({id:cid,serverId:cid,title:d.conversation?.title||"Percakapan",messages:d.messages||[],updated:(d.conversation?.updated_at||0)*1000,loaded:true});
    return showChat(cid);
  }catch{return false}
}
window.addEventListener("popstate",e=>{
  const s=e.state;
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
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&drawerOpen){e.preventDefault();closeDrawer()}});
mq.addEventListener("change",()=>{if(!isDrawerMode())closeDrawerDom(false);syncInert()});

/* ---------- 6. Chat ---------- */
const sortedConversations=()=>[...conversations].sort((a,b)=>(b.updated||0)-(a.updated||0));
function renderHistory(){
  const nav=$("history");nav.replaceChildren();
  if(!inChatView()){$("historyCount").textContent="";return}
  $("historyLabel").textContent=state===AppState.AUTH?"Riwayat akun":"Sesi ini · Guest Mode";
  $("historyCount").textContent=conversations.length?String(conversations.length):"";
  for(const c of sortedConversations()){
    const row=document.createElement("div");row.className="history-row";
    const b=document.createElement("button");b.className="history-item"+(c.id===activeId?" active":"");b.type="button";
    if(c.id===activeId)b.setAttribute("aria-current","page");
    const icon=document.createElement("span");icon.textContent="▤";icon.setAttribute("aria-hidden","true");
    const title=document.createElement("span");title.textContent=c.title||"Percakapan baru";
    b.append(icon,title);b.title=c.title||"Percakapan baru";b.onclick=()=>selectChat(c.id);
    const del=document.createElement("button");del.className="delete-chat";del.type="button";del.textContent="×";del.title="Hapus chat";del.setAttribute("aria-label","Hapus "+(c.title||"chat"));
    del.onclick=e=>{e.stopPropagation();deleteChat(c.id)};
    row.append(b,del);nav.append(row);
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
      c.messages=d.messages||[];c.loaded=true;c.title=d.conversation?.title||c.title;
    }catch(e){if(seq!==navSeq)return null;toast(e.message||"Gagal memuat chat");return false}
    finally{if(seq===navSeq){loadingChat=false;lockComposer()}}
  }
  if(seq!==navSeq)return null;
  activeId=cid;welcomeEl.hidden=true;messagesEl.hidden=false;messagesEl.replaceChildren();
  for(const m of c.messages)appendMessage(m.role,m.content,false);
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
  if(state===AppState.AUTH){try{await syncUserHistory()}catch(e){toast(e.message||"Gagal memuat riwayat")}}
  renderHistory();
  await applyRoute();
}
async function syncUserHistory(){
  const d=await api("/api/conversations");
  conversations=(d.conversations||[]).map(c=>({id:c.id,serverId:c.id,title:c.title,messages:[],updated:(c.updated_at||0)*1000,loaded:false}));
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
function appendFailedTurn(message,text){
  appendMessage("assistant",message);
  const row=messagesEl.lastElementChild;const body=row&&row.querySelector(".message-body");if(!body)return;
  row.classList.add("failed");
  const btn=document.createElement("button");btn.type="button";btn.className="retry-btn";btn.textContent="↻ Coba lagi";
  btn.addEventListener("click",()=>{
    if(busy||loadingChat)return;
    const prev=row.previousElementSibling;row.remove();if(prev&&prev.classList.contains("user"))prev.remove();
    promptEl.value=text;resizePrompt();submit();
  });
  body.append(btn);
}
async function submit(){
  if(busy||loadingChat||!inChatView())return;const text=promptEl.value.trim();if(!text)return;
  busy=true;lockComposer();const agent=$("agent").value;
  let createdNew=false;
  if(!activeId){activeId=id();createdNew=true;conversations.push({id:activeId,serverId:null,title:text.replace(/\s+/g," ").slice(0,72),messages:[],updated:Date.now(),loaded:true})}
  const chat=conversations.find(c=>c.id===activeId);const startId=chat.id;
  const history=buildHistory(chat);const userEntry={role:"user",content:text};chat.messages.push(userEntry);chat.updated=Date.now();
  welcomeEl.hidden=true;messagesEl.hidden=false;appendMessage("user",text);promptEl.value="";resizePrompt();showTyping();renderHistory();
  if(createdNew)replaceRoute({name:"chat",id:chat.id});
  const stillActive=()=>activeId===startId;const start=Date.now();
  try{
    const payload={message:text,agent};if(history.length)payload.history=history;if(state===AppState.AUTH&&chat.serverId)payload.conversationId=chat.serverId;
    const data=await postJson("/api/chat",payload);
    if(typeof data.response!=="string"||!data.response.trim())throw new Error("AI tidak menghasilkan jawaban.");
    chat.messages.push({role:"assistant",content:data.response});chat.updated=Date.now();
    if(stillActive()){$("typing")?.remove();appendMessage("assistant",data.response);renderWorkflow(data.steps)}
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
    const message="Maaf, permintaan gagal diproses. "+(e.message||"Periksa koneksi lalu coba lagi.");
    const at=chat.messages.indexOf(userEntry);if(at>=0)chat.messages.splice(at,1); /* giliran gagal tidak disimpan */
    if(stillActive()){$("typing")?.remove();appendFailedTurn(message,text)}
    toast("Permintaan gagal");
  }finally{busy=false;lockComposer();renderHistory();if(!isDrawerMode())promptEl.focus()}
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
$("continueGuest").addEventListener("click",()=>{writeGuestFlag(true);currentUser=null;setState(AppState.GUEST);enterChat();loadGoogle()});
$("gateRetry").addEventListener("click",boot);
$("googleRetry").addEventListener("click",()=>loadGoogle(true));
$("chatForm").addEventListener("submit",e=>{e.preventDefault();submit()});
promptEl.addEventListener("input",resizePrompt);
promptEl.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();submit()}});
$("newChat").addEventListener("click",newChat);
$("clearHistory").addEventListener("click",clearHistory);
$("signOut").addEventListener("click",signOut);
$("about").addEventListener("click",()=>toast("BOR AI · Intelligence without limits"));
document.querySelectorAll("[data-prompt]").forEach(b=>b.addEventListener("click",()=>{promptEl.value=b.dataset.prompt;resizePrompt();promptEl.focus()}));
history.scrollRestoration="manual";
syncInert();health();boot();
