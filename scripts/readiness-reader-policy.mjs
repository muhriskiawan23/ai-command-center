// Read-only policy: safe-off by default; bounded Reader verification only by explicit manual mode.
export function verifyReaderBindings(bindings,mode,event){
 if(mode!=="off"&&(mode!=="preserved"||event!=="workflow_dispatch"))throw Error("Reader preservation audit requires explicit manual mode");
 if(!Array.isArray(bindings))throw Error("Missing binding inventory");
 const named=name=>bindings.filter(b=>b?.name===name);
 const text=(name,value)=>{const a=named(name);return a.length===1&&a[0].type==="plain_text"&&a[0].text===value;};
 const limit=named("TAVILY_EXTRACT_DAILY_URL_LIMIT");
 if(mode==="off"){
  if(!text("URL_READER_ENABLED","false")||!(limit.length===0||(limit.length===1&&limit[0].type==="plain_text"&&typeof limit[0].text==="string"&&/^0+$/.test(limit[0].text))))throw Error("Reader safe-off binding requirements failed");
 }else{
  const keys=named("TAVILY_API_KEY");
  if(!text("URL_READER_ENABLED","true")||!text("URL_READER_PROVIDER","tavily")||limit.length!==1||limit[0].type!=="plain_text"||typeof limit[0].text!=="string"||!/^[1-8]$/.test(limit[0].text)||keys.length!==1||keys[0].type!=="secret_text")throw Error("Bounded existing Tavily Reader requirements failed");
 }
 return true;
}
export function verifyPublicReader(data,mode,event){
 if(mode!=="off"&&(mode!=="preserved"||event!=="workflow_dispatch"))throw Error("Invalid or unapproved Reader audit mode");
 const tools=data?.tools,enabled=mode==="preserved";
 if(!tools||tools.webReading?.enabled!==enabled||tools.webReading?.available!==enabled||tools.webActions?.available!==false||(enabled&&tools.webSearch?.available!==true))throw Error("Public Reader/Web Actions capabilities disagree with the explicit audit mode");
 return true;
}
