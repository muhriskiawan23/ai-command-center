"use strict";
// BOR AI Media Lab local-only preview. No fetch, XMLHttpRequest, beacon,
// form submit, server upload, AI inference, persistent storage or telemetry.
const $=id=>document.getElementById(id);
const PHOTOS=new Set(["image/png","image/jpeg","image/webp"]);
const VIDEOS=new Set(["video/mp4","video/webm"]);
let original=null,imageUrl=null,videoFile=null,job=0;
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
function repaint(){
  if(!original)return;
  ctx.save();ctx.filter=effectCSS();
  ctx.drawImage(original,0,0,canvas.width,canvas.height);
  ctx.restore();
  $("brightnessValue").textContent=$("brightness").value+"%";
  $("contrastValue").textContent=$("contrast").value+"%";
}
async function loadPhoto(file){
  const generation=++job;
  $("downloadPhoto").disabled=true;$("resetPhoto").disabled=true;
  if(imageUrl){URL.revokeObjectURL(imageUrl);imageUrl=null}
  original=null;
  if(!fileOk(file,PHOTOS,8*1024*1024)){
    setStatus("photo","Format atau ukuran foto tidak didukung (maks. 8 MB).");
    return;
  }
  const url=URL.createObjectURL(file);
  const img=new Image();img.decoding="async";
  try{
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
      background();setStatus("photo",error.message||"Foto tidak dapat dibaca.");
    }
  }finally{
    if(imageUrl!==url)URL.revokeObjectURL(url);
  }
}
$("photoFile").addEventListener("change",event=>{
  void loadPhoto(event.target.files?.[0]);
  event.target.value="";
});
for(const id of ["photoEffect","brightness","contrast"])
  $(id).addEventListener("input",repaint);
$("resetPhoto").addEventListener("click",()=>{
  $("photoEffect").value="natural";
  $("brightness").value="100";$("contrast").value="100";repaint();
});
$("downloadPhoto").addEventListener("click",()=>{
  if(!original)return;
  canvas.toBlob(blob=>{
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
  $("photoWorkspace").hidden=!photo;$("videoWorkspace").hidden=photo;
}
$("photoTab").addEventListener("click",()=>tab("photo"));
$("videoTab").addEventListener("click",()=>tab("video"));
$("videoFile").addEventListener("change",event=>{
  videoFile=event.target.files?.[0]??null;
  $("frameList").replaceChildren();
  $("extractFrames").disabled=!fileOk(videoFile,VIDEOS,40*1024*1024);
  setStatus("video",$("extractFrames").disabled
    ?"Video tidak didukung. Pilih MP4/WebM maks. 40 MB."
    :"Video terpilih. Klik tombol untuk mengambil lima frame.");
});
function awaitEvent(target,success,error,timeoutMs=12000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>finish(false),timeoutMs);
    const done=()=>finish(true);
    const fail=()=>finish(false);
    function finish(ok){
      clearTimeout(timer);
      target.removeEventListener(success,done);
      target.removeEventListener(error,fail);
      ok?resolve():reject(new Error("Tidak dapat membaca atau mengekstrak video."));
    }
    target.addEventListener(success,done,{once:true});
    target.addEventListener(error,fail,{once:true});
  });
}
function seekVideo(video,time){
  const promise=awaitEvent(video,"seeked","error",14000);
  video.currentTime=time;
  return promise;
}
$("extractFrames").addEventListener("click",async()=>{
  if(!fileOk(videoFile,VIDEOS,40*1024*1024))return;
  const file=videoFile;
  const url=URL.createObjectURL(file);
  const video=document.createElement("video");
  video.muted=true;video.playsInline=true;video.preload="auto";
  $("extractFrames").disabled=true;
  $("frameList").replaceChildren();
  setStatus("video","Mengambil cuplikan video di perangkat…");
  try{
    const ready=awaitEvent(video,"loadedmetadata","error",15000);
    video.src=url;await ready;
    const duration=video.duration;
    if(!Number.isFinite(duration)||duration<=0||duration>120)
      throw new Error("Video harus berdurasi lebih dari 0 dan maksimal 120 detik.");
    if(!video.videoWidth||!video.videoHeight)
      throw new Error("Ukuran video tidak dapat dibaca.");
    const scale=Math.min(1,640/video.videoWidth,640/video.videoHeight);
    const tmp=document.createElement("canvas");
    tmp.width=Math.max(1,Math.round(video.videoWidth*scale));
    tmp.height=Math.max(1,Math.round(video.videoHeight*scale));
    const context=tmp.getContext("2d",{alpha:false});
    const times=[0,.25,.5,.75,.98].map(f=>Math.min(Math.max(0,duration-.1),duration*f));
    for(let i=0;i<times.length;i++){
      // The initial frame can already be at 0; avoid hanging waiting for a
      // seeked event when currentTime equals the existing time exactly.
      if(i===0&&Math.abs(video.currentTime-times[i])<.01){
        try{await video.play();video.pause();}catch{}
      }else await seekVideo(video,times[i]);
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
    setStatus("video",error.message||"Ekstraksi video tidak didukung perangkat ini.");
  }finally{
    video.pause();video.removeAttribute("src");video.load();
    URL.revokeObjectURL(url);
    $("extractFrames").disabled=!fileOk(videoFile,VIDEOS,40*1024*1024);
  }
});
