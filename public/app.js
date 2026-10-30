const API="";
const $=id=>document.getElementById(id);
const promptEl=$("prompt"),messagesEl=$("messages"),welcomeEl=$("welcome"),conversation=$("conversation");
let conversations=[],activeId=null,busy=false,currentUser=null,googleClientId=null,googleNonce=null;
function id(){return Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function toast(message){const el=$("toast");el.textContent=message;el.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.hidden=true,2200)}
function escapeHTML(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function markdown(input){let src=String(input||"").replace(/\r\n?/g,"\n");const blocks=[];src=src.replace(/```([\w+-]*)[ \t]*\n([\s\S]*?)```/g,(_,lang,code)=>{const key="@@CB"+blocks.length+"@@";blocks.push("<pre><code>"+escapeHTML(code.replace(/\n$/,""))+"</code></pre>");return key});src=escapeHTML(src).replace(/`([^`\n]+)`/g,"<code>$1</code>").replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g,"$1<em>$2</em>");const out=[];let p=[],list="",q=[];const fp=()=>{if(p.length){out.push("<p>"+p.join("<br>")+"</p>");p=[]}},fl=()=>{if(list){out.push("</"+list+">");list=""}},fq=()=>{if(q.length){out.push("<blockquote>"+q.join("<br>")+"</blockquote>");q=[]}};for(const line of src.split("\n")){const cb=line.match(/^@@CB(\d+)@@$/);if(cb){fp();fl();fq();out.push(blocks[+cb[1]]||"");continue}if(!line.trim()){fp();fl();fq();continue}const h=line.match(/^(#{1,3})\s+(.+)$/);if(h){fp();fl();fq();out.push("<h"+h[1].length+">"+h[2]+"</h"+h[1].length+">");continue}if(/^&gt;\s?/.test(line)){fp();fl();q.push(line.replace(/^&gt;\s?/,""));continue}else fq();const ul=line.match(/^\s*[-*+]\s+(.+)$/),ol=line.match(/^\s*\d+[.)]\s+(.+)$/);if(ul||ol){fp();const want=ul?"ul":"ol";if(list!==want){fl();out.push("<"+want+">");list=want}out.push("<li>"+(ul||ol)[1]+"</li>");continue}fl();p.push(line)}fp();fl();fq();return out.join("\n").replace(/@@CB(\d+)@@/g,(_,n)=>blocks[+n]||"")}
function save(){renderHistory()}
function renderHistory(){
 const nav=$("history");nav.replaceChildren();
 $("historyLabel").textContent=currentUser?"Riwayat akun":"Sesi ini · Guest Mode";
 $("historyCount").textContent=conversations.length?String(conversations.length):"";
 for(const c of [...conversations].reverse()){
  const row=document.createElement("div");row.className="history-row";
  const b=document.createElement("button");b.className="history-item"+(c.id===activeId?" active":"");b.type="button";
  const icon=document.createElement("span");icon.textContent="▤";
  const title=document.createElement("span");title.textContent=c.title||"Percakapan baru";
  b.append(icon,title);b.title=c.title||"Percakapan baru";b.onclick=()=>loadChat(c.id);
  const del=document.createElement("button");del.className="delete-chat";del.type="button";del.textContent="×";del.title="Hapus chat";del.setAttribute("aria-label","Hapus "+(c.title||"chat"));
  del.onclick=e=>{e.stopPropagation();deleteChat(c.id)};
  row.append(b,del);nav.append(row);
 }
}
function newChat(){if(busy)return;activeId=null;messagesEl.replaceChildren();messagesEl.hidden=true;welcomeEl.hidden=false;$("workflow").hidden=true;promptEl.value="";resizePrompt();renderHistory();$("sidebar").classList.remove("open");promptEl.focus()}
async function loadChat(cid){
 if(busy)return;let c=conversations.find(x=>x.id===cid);if(!c)return;
 if(currentUser&&!c.loaded&&c.serverId){
  try{const r=await fetch(API+"/api/conversations/"+encodeURIComponent(c.serverId),{credentials:"same-origin"});const d=await r.json();if(!r.ok)throw Error(d.error||"Gagal memuat chat");c.messages=d.messages||[];c.loaded=true;c.title=d.conversation?.title||c.title}
  catch(e){toast(e.message||"Gagal memuat chat");return}
 }
 activeId=cid;welcomeEl.hidden=true;messagesEl.hidden=false;messagesEl.replaceChildren();
 for(const m of c.messages)appendMessage(m.role,m.content,false);
 $("workflow").hidden=true;renderHistory();$("sidebar").classList.remove("open");conversation.scrollTop=conversation.scrollHeight;
}
function appendMessage(role,content,scroll=true){const row=document.createElement("article");row.className="message "+role;const avatar=document.createElement("div");avatar.className="avatar";avatar.textContent=role==="user"?"B":"✳";const body=document.createElement("div");body.className="message-body";body.innerHTML=markdown(content);row.append(avatar,body);if(role==="assistant"){const actions=document.createElement("div");actions.className="message-actions";const copy=document.createElement("button");copy.className="tiny-btn";copy.textContent="Salin";copy.onclick=async()=>{try{await navigator.clipboard.writeText(content);toast("Jawaban disalin")}catch{toast("Gagal menyalin jawaban")}};actions.append(copy);body.append(actions)}messagesEl.append(row);if(scroll)conversation.scrollTop=conversation.scrollHeight;return row}
function showTyping(){const row=document.createElement("article");row.className="message assistant";row.id="typing";row.innerHTML='<div class="avatar">✳</div><div class="message-body"><span class="typing"><i></i><i></i><i></i></span> <span style="color:#aaa;font-size:12px">AI sedang berpikir…</span></div>';messagesEl.append(row);conversation.scrollTop=conversation.scrollHeight}
function renderWorkflow(steps){const items=$("workflowItems");items.replaceChildren();if(!Array.isArray(steps)||!steps.length){$("workflow").hidden=true;return}$("workflow").hidden=false;for(const s of steps){const d=document.createElement("details");d.className="workflow-step";const sum=document.createElement("summary");const title=document.createElement("span");title.textContent=s.agent||"Agent";const status=document.createElement("span");status.textContent=s.status==="completed"?"Selesai":s.status==="skipped"?"Dilewati":"Perlu diperiksa";sum.append(title,status);const text=document.createElement("div");text.className="step-text";text.textContent=s.output||"Tidak ada output";d.append(sum,text);items.append(d)}}
async function submit(){
 if(busy)return;const text=promptEl.value.trim();if(!text)return;
 busy=true;$("send").disabled=true;promptEl.disabled=true;const agent=$("agent").value;
 if(!activeId){activeId=id();conversations.push({id:activeId,serverId:null,title:text.slice(0,42)+(text.length>42?"…":""),messages:[],updated:Date.now(),loaded:true})}
 const chat=conversations.find(c=>c.id===activeId);chat.messages.push({role:"user",content:text});
 welcomeEl.hidden=true;messagesEl.hidden=false;appendMessage("user",text);promptEl.value="";resizePrompt();showTyping();save();const start=Date.now();
 try{
  const payload={message:text,agent};if(currentUser&&chat.serverId)payload.conversationId=chat.serverId;
  const res=await fetch(API+"/api/chat",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  let data;try{data=await res.json()}catch{throw new Error("Server mengembalikan respons yang tidak valid.")}
  if(!res.ok)throw new Error(data.error||"HTTP "+res.status);
  if(typeof data.response!=="string"||!data.response.trim())throw new Error("AI tidak menghasilkan jawaban.");
  $("typing")?.remove();chat.messages.push({role:"assistant",content:data.response});chat.updated=Date.now();
  appendMessage("assistant",data.response);renderWorkflow(data.steps);
  if(currentUser&&data.saved&&data.conversationId){chat.serverId=data.conversationId;chat.id=data.conversationId;activeId=chat.id;chat.loaded=true}
  if(data.saveWarning)toast(data.saveWarning);else toast("Selesai dalam "+((Date.now()-start)/1000).toFixed(1)+" detik");
  save();
 }catch(e){
  $("typing")?.remove();const message="Maaf, permintaan gagal diproses. "+(e.message||"Periksa koneksi lalu coba lagi.");
  chat.messages.push({role:"assistant",content:message});appendMessage("assistant",message);save();toast("Permintaan gagal");
 }finally{busy=false;$("send").disabled=false;promptEl.disabled=false;promptEl.focus()}
}
async function deleteChat(cid){
 if(busy)return;const chat=conversations.find(c=>c.id===cid);if(!chat)return;
 if(!confirm("Hapus percakapan ini?"))return;
 try{if(currentUser&&chat.serverId){const r=await fetch(API+"/api/conversations/"+encodeURIComponent(chat.serverId),{method:"DELETE",credentials:"same-origin"});const d=await r.json();if(!r.ok)throw Error(d.error||"Gagal menghapus chat")}
  conversations=conversations.filter(c=>c.id!==cid);if(activeId===cid)newChat();else renderHistory();toast("Chat dihapus");
 }catch(e){toast(e.message||"Gagal menghapus chat")}
}
async function clearHistory(){
 if(busy||!conversations.length)return;if(!confirm("Hapus semua riwayat chat?"))return;
 try{if(currentUser){const r=await fetch(API+"/api/conversations",{method:"DELETE",credentials:"same-origin"});const d=await r.json();if(!r.ok)throw Error(d.error||"Gagal menghapus riwayat")}
  conversations=[];newChat();toast("Semua riwayat dihapus");
 }catch(e){toast(e.message||"Gagal menghapus riwayat")}
}
async function syncUserHistory(){
 const r=await fetch(API+"/api/conversations",{credentials:"same-origin"});const d=await r.json();if(!r.ok)throw Error(d.error||"Gagal memuat riwayat");
 conversations=(d.conversations||[]).map(c=>({id:c.id,serverId:c.id,title:c.title,messages:[],updated:c.updated_at,loaded:false}));
 activeId=null;newChat();
}
function renderAuth(){
 const logged=Boolean(currentUser);
 $("authTitle").textContent=logged?"Masuk sebagai":"Guest Mode";
 $("authDescription").textContent=logged?(currentUser.email||"Riwayat chat tersimpan di akun Google."):"Chat hanya tersimpan sementara selama halaman ini terbuka. Masuk Google untuk menyimpan riwayat.";
 $("googleButton").hidden=logged;$("userProfile").hidden=!logged;$("signOut").hidden=!logged;
 $("googleButton").replaceChildren();$("userProfile").replaceChildren();
 if(logged){
  const wrap=document.createElement("div");wrap.className="auth-user";
  if(currentUser.picture){const img=document.createElement("img");img.src=currentUser.picture;img.alt="";wrap.append(img)}
  const info=document.createElement("div");info.className="auth-user-info";
  const name=document.createElement("strong");name.textContent=currentUser.name||"Akun Google";
  const email=document.createElement("small");email.textContent=currentUser.email||"";
  info.append(name,email);wrap.append(info);$("userProfile").append(wrap);
  $("historyLabel").textContent="Riwayat akun";
 }else $("historyLabel").textContent="Sesi ini · Guest Mode";
 renderHistory();
}
async function initializeGoogleSignIn(){
 try{
  const configResponse=await fetch(API+"/api/config");const config=await configResponse.json();googleClientId=config.googleClientId;
  if(!config.googleSignInEnabled||!googleClientId){$("authDescription").textContent="Guest Mode aktif. Login Google belum dikonfigurasi di server.";return}
  if(!window.google?.accounts?.id){
   await new Promise(resolve=>{const sdk=document.querySelector('script[src*="accounts.google.com/gsi/client"]');let done=false;const finish=()=>{if(done)return;done=true;resolve()};sdk?.addEventListener("load",finish,{once:true});sdk?.addEventListener("error",finish,{once:true});setTimeout(finish,7000)});
  }
  if(!window.google?.accounts?.id){$("authDescription").textContent="Google Sign-In gagal dimuat. Guest Mode tetap bisa digunakan.";return}
  const nonceResponse=await fetch(API+"/api/auth/nonce",{credentials:"same-origin"});const nonceData=await nonceResponse.json();
  if(!nonceResponse.ok)throw Error(nonceData.error||"Login Google belum tersedia");googleNonce=nonceData.nonce;
  google.accounts.id.initialize({client_id:googleClientId,nonce:googleNonce,auto_select:false,callback:handleGoogleCredential});
  google.accounts.id.renderButton($("googleButton"),{theme:"filled_black",size:"large",shape:"pill",text:"signin_with",width:220});
 }catch(e){$("authDescription").textContent="Guest Mode aktif. "+(e.message||"Login Google belum siap.");}
}
async function handleGoogleCredential(result){
 try{
  const r=await fetch(API+"/api/auth/google",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({credential:result.credential,nonce:googleNonce})});
  const d=await r.json();if(!r.ok)throw Error(d.error||"Login Google gagal");
  currentUser=d.user;conversations=[];newChat();renderAuth();await syncUserHistory();renderAuth();toast("Berhasil masuk dengan Google");
 }catch(e){toast(e.message||"Login Google gagal");initializeGoogleSignIn()}
}
async function initializeAuth(){
 try{
  const r=await fetch(API+"/api/auth/me",{credentials:"same-origin"});const d=await r.json();
  if(r.ok&&d.authenticated){currentUser=d.user;await syncUserHistory()}
 }catch(e){toast("Status akun belum dapat diperiksa")}
 renderAuth();initializeGoogleSignIn();
}
function resizePrompt(){promptEl.style.height="auto";promptEl.style.height=Math.min(promptEl.scrollHeight,220)+"px"}
$("chatForm").addEventListener("submit",e=>{e.preventDefault();submit()});promptEl.addEventListener("input",resizePrompt);promptEl.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&!e.isComposing){e.preventDefault();submit()}});$("newChat").onclick=newChat;$("menuBtn").onclick=()=> $("sidebar").classList.toggle("open");$("clearHistory").onclick=clearHistory;$("signOut").onclick=async()=>{try{await fetch(API+"/api/auth/logout",{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json"}});if(window.google?.accounts?.id)google.accounts.id.disableAutoSelect();window.location.reload()}catch{toast("Gagal keluar dari akun")}};$("about").onclick=()=>toast("AI Command Center · Multi-agent AI workspace");document.querySelectorAll("[data-prompt]").forEach(b=>b.onclick=()=>{promptEl.value=b.dataset.prompt;resizePrompt();promptEl.focus()});renderHistory();initializeAuth();
async function health(){try{const r=await fetch(API+"/api/health");if(!r.ok)throw Error();const d=await r.json();$("healthDot").className="dot "+(d.ok?"ok":"bad");$("healthText").textContent=d.ok?"Layanan terhubung":"Layanan bermasalah"}catch{$("healthDot").className="dot bad";$("healthText").textContent="Tidak terhubung"}}
health();
