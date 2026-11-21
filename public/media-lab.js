"use strict";
import {validateImageBytes} from "./media-validation.js";
// BOR AI Media Lab local-only preview. No fetch, XMLHttpRequest, beacon,
// form submit, server upload, AI inference, persistent storage or telemetry.
const $=id=>document.getElementById(id);
const PHOTOS=new Set(["image/png","image/jpeg","image/webp"]);
const VIDEOS=new Set(["video/mp4","video/webm"]);
let original=null,imageUrl=null,videoFile=null,job=0,videoJob=null;
const canvas=$("photoCanvas"),ctx=canvas.getContext("2d",{alpha:false});
function setStatus(type,msg){$(type+"Status").textContent=msg}
function fileOk(file,allowed,max){
  return file&&allowed.has(file.type)&&file.size>0&&file.size<=max;
}
function background(){
  ctx.fillStyle="#0a1020";ctx.fillRect(0,0,canvas.width,canvas.height);
}
background();
function effectCSS(){
  const base={
    natural:"",
    mono:"grayscale(1)",
    vintage:"sepia(.65) saturate(.85)",
    cinematic:"saturate(.84) contrast(1.12) hue-rotate(-7deg)",
    vivid:"saturate(1.48)",
    soft:"saturate(.92) contrast(.91) blur(.35px)"
  };
  return [
    base[$("photoEffect").value]??"",
    "brightness("+$("brightness").value+"%)",
    "contrast("+$("contrast").value+"%)"
  ].filter(Boolean).join(" ");
}

function drawCaption(){
  const words=String($("captionText").value||"").trim().split(/\s+/).filter(Boolean);
  if(!words.length)return;
  const size=Math.max(14,Math.min(76,Math.floor(canvas.width/12)));
  ctx.save();
  ctx.filter="none";
  ctx.font="700 "+size+"px system-ui, sans-serif";
  ctx.textAlign="center";
  ctx.textBaseline="middle";
  const maxWidth=canvas.width*.86, lines=[];
  let line="";
  for(const word of words){
    const candidate=line?line+" "+word:word;
    if(line&&ctx.measureText(candidate).width>maxWidth){
      lines.push(line);line=word;
    } else line=candidate;
  }
  if(line)lines.push(line);
  const shown=lines.slice(0,3);
  const height=size*1.25;
  const top=$("captionPlacement").value==="top"?size*.8:
    $("captionPlacement").value==="center"?(canvas.height-shown.length*height)/2:
    canvas.height-shown.length*height-size*.8;
  const y=Math.max(0,Math.min(top,canvas.height-shown.length*height));
  ctx.fillStyle="rgba(0,0,0,.62)";
  ctx.fillRect(0,Math.max(0,y-size*.22),canvas.width,Math.min(canvas.height-y+size*.22,shown.length*height+size*.44));
  ctx.fillStyle=$("captionColor").value;
  ctx.strokeStyle="rgba(0,0,0,.9)";
  ctx.lineWidth=Math.max(2,Math.round(size*.07));
  for(let i=0;i<shown.length;i++){
    const text=shown[i];
    const tx=canvas.width/2,ty=y+i*height+height/2;
    ctx.strokeText(text,tx,ty,maxWidth);
    ctx.fillText(text,tx,ty,maxWidth);
  }
  ctx.restore();
}
function repaint(){
  if(!original)return;
  ctx.save();ctx.filter=effectCSS();
  ctx.drawImage(original,0,0,canvas.width,canvas.height);
  ctx.restore();
  drawCaption();
  $("brightnessValue").textContent=$("brightness").value+"%";
  $("contrastValue").textContent=$("contrast").value+"%";
}
async function loadPhoto(file){
  const generation=++job;
  $("downloadPhoto").disabled=true;$("resetPhoto").disabled=true;
  if(imageUrl){URL.revokeObjectURL(imageUrl);imageUrl=null}
  original=null;
  background();
  if(!fileOk(file,PHOTOS,8*1024*1024)){
    setStatus("photo","Format atau ukuran foto tidak didukung (maks. 8 MB).");
    return;
  }
  let url=null;
  const img=new Image();img.decoding="async";
  try{
    // Check dimensions and container BEFORE asking the browser to decompress.
    validateImageBytes(new Uint8Array(await file.arrayBuffer()),file.type,{
      maxBytes:8*1024*1024,maxWidth:8192,maxHeight:8192
    });
    if(generation!==job)return;
    url=URL.createObjectURL(file);
    img.src=url;await img.decode();
    if(generation!==job)return;
    if(img.naturalWidth<32||img.naturalHeight<32||
      img.naturalWidth>8192||img.naturalHeight>8192||
      img.naturalWidth*img.naturalHeight>16*1024*1024)
      throw new Error("Dimensi gambar terlalu besar atau kecil.");
    imageUrl=url;
    const ratio=Math.min(1,2048/img.naturalWidth,2048/img.naturalHeight);
    canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
    original=img;repaint();
    $("downloadPhoto").disabled=false;$("resetPhoto").disabled=false;
    setStatus("photo","Foto siap. Efek dibuat lokal di browser.");
  }catch(error){
    if(generation===job){
      background();setStatus("photo","Foto tidak dapat dibaca. Gunakan JPG, PNG, atau WebP statis yang valid (32–8192 piksel, maks. 16 megapiksel).");
    }
  }finally{
    if(url&&imageUrl!==url)URL.revokeObjectURL(url);
  }
}
$("photoFile").addEventListener("change",event=>{
  void loadPhoto(event.target.files?.[0]);
  event.target.value="";
});
for(const id of ["photoEffect","brightness","contrast","captionText","captionPlacement","captionColor"])
  $(id).addEventListener("input",repaint);
$("resetPhoto").addEventListener("click",()=>{
  $("photoEffect").value="natural";
  $("brightness").value="100";$("contrast").value="100";$("captionText").value="";$("captionPlacement").value="bottom";$("captionColor").value="#ffffff";repaint();
});
$("downloadPhoto").addEventListener("click",()=>{
  if(!original)return;
  const generation=job;
  canvas.toBlob(blob=>{
    if(generation!==job)return;
    if(!blob){setStatus("photo","Tidak dapat membuat file PNG.");return}
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download="bor-ai-photo-effect.png";
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),3000);
    setStatus("photo","PNG hasil efek dibuat. Foto asli tidak berubah.");
  },"image/png");
});
function tab(active){
  const photo=active==="photo";
  $("photoTab").setAttribute("aria-selected",String(photo));
  $("videoTab").setAttribute("aria-selected",String(!photo));
  $("photoTab").tabIndex=photo?0:-1;
  $("videoTab").tabIndex=photo?-1:0;
  $("photoWorkspace").hidden=!photo;$("videoWorkspace").hidden=photo;
}
$("photoTab").addEventListener("click",()=>tab("photo"));
$("videoTab").addEventListener("click",()=>tab("video"));
for(const id of ["photoTab","videoTab"]){
  $(id).addEventListener("keydown",event=>{
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
    event.preventDefault();
    const active=event.key==="Home"?"photo":event.key==="End"?"video":id==="photoTab"?"video":"photo";
    tab(active);$(active+"Tab").focus();
  });
}
function cancelVideoJob(){
  if(!videoJob)return;
  const current=videoJob;videoJob=null;current.controller.abort();
  $("extractFrames").disabled=!fileOk(videoFile,VIDEOS,40*1024*1024);
}
$("videoFile").addEventListener("change",event=>{
  cancelVideoJob();
  videoFile=event.target.files?.[0]??null;
  $("frameList").replaceChildren();
  $("extractFrames").disabled=!fileOk(videoFile,VIDEOS,40*1024*1024);
  setStatus("video",$("extractFrames").disabled
    ?"Video tidak didukung. Pilih MP4/WebM maks. 40 MB."
    :"Video terpilih. Klik tombol untuk mengambil lima frame.");
  event.target.value="";
});
function awaitEvent(target,success,error,signal,timeoutMs=12000,start=()=>{}){
  return new Promise((resolve,reject)=>{
    let settled=false;
    const timer=setTimeout(()=>finish(new Error("Tidak dapat membaca atau mengekstrak video.")),timeoutMs);
    const done=()=>finish();
    const fail=()=>finish(new Error("Tidak dapat membaca atau mengekstrak video."));
    const abort=()=>finish(new DOMException("Dibatalkan","AbortError"));
    function finish(failure){
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      target.removeEventListener(success,done);
      target.removeEventListener(error,fail);
      signal?.removeEventListener("abort",abort);
      failure?reject(failure):resolve();
    }
    target.addEventListener(success,done,{once:true});
    target.addEventListener(error,fail,{once:true});
    signal?.addEventListener("abort",abort,{once:true});
    if(signal?.aborted)abort();
    else {try{start()}catch(error){finish(error)}}
  });
}
async function seekVideo(video,time,signal){
  if(Math.abs(video.currentTime-time)<.000001 && video.readyState>=2)return;
  await awaitEvent(video,"seeked","error",signal,14000,()=>{video.currentTime=time});
}
$("extractFrames").addEventListener("click",async()=>{
  if(!fileOk(videoFile,VIDEOS,40*1024*1024))return;
  cancelVideoJob();
  const current={controller:new AbortController()};videoJob=current;
  const signal=current.controller.signal;
  const file=videoFile;
  const url=URL.createObjectURL(file);
  const video=document.createElement("video");
  video.muted=true;video.playsInline=true;video.preload="auto";
  $("extractFrames").disabled=true;
  $("frameList").replaceChildren();
  setStatus("video","Mengambil cuplikan video di perangkat…");
  try{
    await awaitEvent(video,"loadeddata","error",signal,15000,()=>{video.src=url});
    const duration=video.duration;
    if(!Number.isFinite(duration)||duration<=0||duration>120)
      throw new Error("Video harus berdurasi lebih dari 0 dan maksimal 120 detik.");
    if(!video.videoWidth||!video.videoHeight || video.videoWidth>8192 || video.videoHeight>8192 || video.videoWidth*video.videoHeight>16*1024*1024)
      throw new Error("Dimensi video tidak didukung (maks. 16 megapiksel).");
    const scale=Math.min(1,640/video.videoWidth,640/video.videoHeight);
    const tmp=document.createElement("canvas");
    tmp.width=Math.max(1,Math.round(video.videoWidth*scale));
    tmp.height=Math.max(1,Math.round(video.videoHeight*scale));
    const context=tmp.getContext("2d",{alpha:false});
    const times=[0,.25,.5,.75,.98].map(f=>duration*f);
    for(let i=0;i<times.length;i++){
      await seekVideo(video,times[i],signal);
      if(videoJob!==current)return;
      context.drawImage(video,0,0,tmp.width,tmp.height);
      const fig=document.createElement("figure");
      fig.className="frame-card";
      const img=document.createElement("img");
      img.alt="Frame video pada detik "+times[i].toFixed(1);
      img.src=tmp.toDataURL("image/jpeg",.75);
      const caption=document.createElement("figcaption");
      caption.textContent="Detik "+times[i].toFixed(1);
      fig.append(img,caption);$("frameList").append(fig);
    }
    setStatus("video","Lima frame berhasil diambil secara lokal. Tidak ada analisis audio/AI.");
  }catch(error){
    if(videoJob===current){
      $("frameList").replaceChildren();
      setStatus("video",error.message||"Ekstraksi video tidak didukung perangkat ini.");
    }
  }finally{
    video.pause();video.removeAttribute("src");video.load();
    URL.revokeObjectURL(url);
    if(videoJob===current){
      videoJob=null;
      $("extractFrames").disabled=!fileOk(videoFile,VIDEOS,40*1024*1024);
    }
  }
});
// Import the current chat attachment without a network upload. This
// handshake only accepts this exact same-origin opener Window and a real File.
window.addEventListener("message",event=>{
  if(event.origin!==location.origin||event.source!==window.opener||
     event.data?.type!=="bor-media-lab-photo")return;
  const file=event.data?.file;
  if(!(file instanceof File))return;
  tab("photo");
  void loadPhoto(file);
});
if(window.opener&&window.opener!==window){
  try{window.opener.postMessage({type:"bor-media-lab-ready"},location.origin);}catch{}
}
window.addEventListener("pagehide",()=>{
  cancelVideoJob();job++;
  if(imageUrl){URL.revokeObjectURL(imageUrl);imageUrl=null}
});
