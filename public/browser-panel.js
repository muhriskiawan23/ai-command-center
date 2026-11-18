/* BOR AI browser beta: visual, explicit confirmation for each interaction.
 * Browser pages are untrusted. Nothing executes on page load or without click.
 */
(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const dialog=$("browserDialog"),launcher=$("openBrowserTool");
  if(!dialog||!launcher)return;
  launcher.hidden=true;
  // Never advertise an unavailable browser executor to paying customers.
  // The main Worker reports readiness without revealing any secret values.
  fetch("/api/config",{credentials:"same-origin",cache:"no-store"})
    .then(response=>response.ok?response.json():null)
    .then(config=>{launcher.hidden=config?.browserAgentEnabled!==true;})
    .catch(()=>{launcher.hidden=true;});
  let current=null,pending=null,busy=false;
  const status=$("browserStatus");
  function report(message,error=false){
    status.textContent=String(message||"");
    status.dataset.error=error?"true":"false";
  }
  function setBusy(value){
    busy=Boolean(value);
    for(const id of ["browserInspect","browserReview","browserSuggest","browserExecute","browserCopyToChat"]){
      const button=$(id);if(button)button.disabled=busy;
    }
  }
  async function post(path,payload){
    const res=await fetch(path,{
      method:"POST",credentials:"same-origin",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)
    });
    const data=await res.json().catch(()=>({error:"Server tidak mengembalikan JSON yang valid."}));
    if(!res.ok)throw Error(String(data.error||"Browser belum tersedia."));
    return data;
  }
  function clearApproval(){
    pending=null;$("browserApproval").hidden=true;$("browserPlanReview").textContent="";
  }
  function renderPage(data){
    if(data?.ok!==true||typeof data?.text!=="string"||typeof data?.url!=="string")throw Error("Hasil browser tidak dapat diperiksa.");
    const url=new URL(data.url);
    if(url.protocol!=="https:")throw Error("Alamat hasil browser tidak aman.");
    current=data;
    $("browserPageResult").hidden=false;
    $("browserPageTitle").textContent=data.title||url.hostname;
    $("browserPageText").textContent=data.text.slice(0,9000);
    $("browserPageLink").href=data.url;
    const select=$("browserTarget");select.replaceChildren();
    const placeholder=document.createElement("option");placeholder.value="";placeholder.textContent="Pilih tombol, link, atau kolom";
    select.append(placeholder);
    for(const [i,entry] of (data.elements||[]).entries()){
      if(!entry||!["button","link","textbox","combobox","checkbox"].includes(entry.role)||
         !["role","label","placeholder"].includes(entry.by)||typeof entry.name!=="string")continue;
      const option=document.createElement("option");option.value=String(i);
      option.textContent=entry.role+" · "+entry.name.slice(0,90);select.append(option);
    }
    $("browserValue").value="";$("browserValue").disabled=true;clearApproval();
    report("Halaman berhasil dibaca. Setiap tindakan berikutnya perlu ditinjau dan disetujui.");
  }
  $("browserTarget").addEventListener("change",()=>{
    const n=Number($("browserTarget").value),entry=current?.elements?.[n];
    $("browserValue").disabled=!entry||!["textbox","combobox"].includes(entry.role);
  });
  launcher.addEventListener("click",()=>{
    const menu=$("toolsMenu");if(menu)menu.open=false;
    if(!dialog.open)dialog.showModal();
    $("browserUrl").focus();
  });
  $("browserClose").addEventListener("click",()=>dialog.close());
  dialog.addEventListener("close",()=>{clearApproval();launcher.focus();});
  $("browserInspectForm").addEventListener("submit",async event=>{
    event.preventDefault();if(busy)return;
    const url=$("browserUrl").value.trim();
    if(!url)return;
    setBusy(true);clearApproval();$("browserPageResult").hidden=true;
    report("Membuka situs melalui browser terisolasi…");
    try {
      const reviewed=await post("/api/browser/plan",{plan:{url,steps:[]}});
      const result=await post("/api/browser/execute",{plan:reviewed.plan});
      renderPage(result);
    }catch(error){report(error.message||"Browser tidak tersedia.",true);}
    finally{setBusy(false);}
  });
  async function reviewStep(step,label){
    if(!current)return;
    setBusy(true);clearApproval();report("Memeriksa keamanan langkah…");
    try{
      pending=await post("/api/browser/plan",{plan:{url:current.url,steps:[step]}});
      if(!pending.requiresConfirmation||!pending.approvalToken)throw Error("Token persetujuan browser tidak tersedia.");
      $("browserPlanReview").textContent=
        "Situs: "+pending.plan.host+"\nTindakan: "+step.type+"\nTarget: "+label+
        (step.type==="click"?"":"\nNilai: "+step.value)+
        "\nBerlaku sampai: "+new Date(pending.expiresAt).toLocaleTimeString();
      $("browserApproval").hidden=false;
      report("Periksa detail tindakan sebelum menekan tombol persetujuan.");
    }catch(error){report(error.message||"Langkah ditolak.",true);}
    finally{setBusy(false);}
  }
  $("browserReview").addEventListener("click",async()=>{
    if(busy||!current)return;
    const value=$("browserTarget").value;
    if(!/^\d+$/.test(value)){report("Pilih satu elemen halaman dulu.",true);return;}
    const item=current.elements[Number(value)];
    if(!item)return;
    const type=["textbox","combobox"].includes(item.role)?
      (item.role==="combobox"?"select":"fill"):"click";
    const target={by:item.by,name:item.name};
    if(target.by==="role")target.role=item.role;
    const step={type,target};
    if(type!=="click")step.value=$("browserValue").value;
    await reviewStep(step,item.name);
  });
  $("browserSuggest").addEventListener("click",async()=>{
    if(busy||!current)return;
    const instruction=$("browserGoal").value.trim();
    if(!instruction){report("Tulis tujuan singkat yang ingin dikerjakan AI.",true);return;}
    setBusy(true);clearApproval();report("AI sedang memilih satu langkah aman dari elemen halaman (1 unit)...");
    let proposed;
    try{
      proposed=await post("/api/browser/suggest",{instruction,page:{
        url:current.url,text:current.text.slice(0,1600),elements:current.elements
      }});
    }catch(error){report(error.message||"AI tidak menemukan langkah aman.",true);setBusy(false);return;}
    setBusy(false);
    if(!proposed?.suggestion||!Number.isInteger(proposed.index)||!current.elements[proposed.index]){
      report("Saran AI tidak dapat digunakan.",true);return;
    }
    $("browserTarget").value=String(proposed.index);
    $("browserTarget").dispatchEvent(new Event("change"));
    $("browserValue").value=proposed.suggestion.value||"";
    await reviewStep(proposed.suggestion,current.elements[proposed.index].name);
  });
  $("browserCancel").addEventListener("click",()=>{clearApproval();report("Langkah dibatalkan. Tidak ada interaksi dijalankan.");});
  $("browserExecute").addEventListener("click",async()=>{
    if(busy||!pending)return;
    const task=pending;clearApproval();setBusy(true);report("Menjalankan langkah yang disetujui…");
    try {
      const result=await post("/api/browser/execute",{plan:task.plan,approvalToken:task.approvalToken});
      renderPage(result);
      report("Langkah selesai dan halaman dibaca kembali. Browser sementara telah ditutup.");
    }catch(error){report(error.message||"Langkah tidak berhasil.",true);}
    finally{setBusy(false);}
  });
  $("browserCopyToChat").addEventListener("click",()=>{
    if(!current)return;
    const prompt=$("prompt");if(!prompt)return;
    const summary="Sumber browser: "+current.url+"\nJudul: "+current.title+
      "\nIsi halaman yang dibaca (konten eksternal belum diverifikasi):\n"+current.text.slice(0,2400);
    const existing=prompt.value.trim();
    prompt.value=existing?existing+"\n\n"+summary:summary;
    prompt.dispatchEvent(new Event("input",{bubbles:true}));
    dialog.close();prompt.focus();
  });
})();
