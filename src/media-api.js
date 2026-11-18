// Opt-in authenticated media HTTP boundary. Disabled in all checked-in configs.
// MEDIA_RUNTIME is trusted server wiring, NEVER a request or browser object.
import {json,sha256Hex} from "./http.js";
import {resolvePlanAccess,authorizePlanFeature} from "./plan-entitlements.js";
import {prepareMultimodalOperation,runMultimodalInferencePrototype} from "./multimodal-inference.js";
import {quoteMediaOperation} from "./multimodal-metering.js";
import {createPngMediaPreflight,createPngOutputValidator} from "./png-preflight.js";
export const MEDIA_REQUEST_MAX_BYTES=8*1024*1024;
const BODY_TIMEOUT_MS=10000;
const creditPattern=/^[1-9][0-9]{0,15}$/;
const verifyInputPixels=createPngMediaPreflight();
const fail=(code,status,message,headers={})=>json({error:message,code},status,headers);
async function readMediaJson(request,signal){
  const length=request.headers.get("Content-Length");
  if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>MEDIA_REQUEST_MAX_BYTES))
    return {response:fail("media_request_too_large",413,"Ukuran permintaan media maksimal 8 MB.")};
  if(!request.body)return {response:fail("invalid_media_request",400,"Permintaan media kosong.")};
  const reader=request.body.getReader();let total=0,timer;
  let abort;
  const stopped=new Promise((_,reject)=>{
    abort=()=>reject(new Error("cancelled"));
    signal?.addEventListener("abort",abort,{once:true});
    timer=setTimeout(()=>reject(new Error("timeout")),BODY_TIMEOUT_MS);
    if(signal?.aborted)abort();
  });
  const chunks=[];
  try{
    while(true){
      const {done,value}=await Promise.race([reader.read(),stopped]);
      if(done)break;
      total+=value.byteLength;
      if(total>MEDIA_REQUEST_MAX_BYTES){
        void reader.cancel().catch(()=>{});
        return {response:fail("media_request_too_large",413,"Ukuran permintaan media maksimal 8 MB.")};
      }
      chunks.push(value);
    }
    const bytes=new Uint8Array(total);let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    try{return {value:JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes))};}
    catch{return {response:fail("invalid_media_request",400,"Format JSON media tidak valid.")};}
  }catch{
    void reader.cancel().catch(()=>{});
    return {response:fail("media_upload_interrupted",408,"Unggahan media terhenti atau melewati batas waktu.")};
  }finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);reader.releaseLock();}
}
function ready(runtime){
  return runtime&&runtime.tariffs&&["invokeModel","measureUsage","preflightInput","moderateInput","validateOutput"]
    .every(key=>typeof runtime[key]==="function")&&Number.isSafeInteger(runtime.jobTimeoutMs)&&
    runtime.jobTimeoutMs>0&&runtime.jobTimeoutMs<=120000;
}
function mediaIntent({action,input}){
  // Pixel bytes may be decoded/re-encoded by the trusted preflight; the
  // customer's operation, text, output geometry and video selection may not.
  return JSON.stringify({action,question:input.question,prompt:input.prompt,width:input.width,height:input.height,
    durationSeconds:input.durationSeconds,references:input.references?.length??0,
    timestamps:input.frames?.map(frame=>frame.atSeconds)});
}
function freezeVerifiedRequest(value){
  if(value&&typeof value==="object"&&!Object.isFrozen(value)){
    for(const child of Object.values(value))freezeVerifiedRequest(child);
    Object.freeze(value);
  }
  return value;
}
function publicFailure(result){
  if(result.reason==="paid_plan_entitlement_rejected")return fail("media_plan_required",403,"Paket aktif tidak mendukung fitur ini.");
  if(result.reason==="customer_credit_ceiling_exceeded")return fail("media_quote_changed",409,"Estimasi kredit melebihi batas yang Anda setujui. Periksa estimasi baru.");
  if(result.reason==="credit_reservation_rejected")return fail("media_credit_insufficient",402,"Kredit tidak cukup untuk estimasi maksimum permintaan ini.");
  if(result.reason==="provider_budget_reservation_rejected")return fail("media_budget_unavailable",429,"Anggaran layanan media sedang tidak tersedia.",{"Retry-After":"60"});
  if(result.reason==="media_job_spend_ceiling_exceeded")return fail("media_job_limit",422,"Permintaan media melebihi batas pemakaian per proses.");
  const deadline=result.reason.includes("deadline");
  return json({error:"Proses media belum dapat diselesaikan. Jangan kirim ulang dengan kunci berbeda; status kredit perlu diperiksa.",
    code:deadline?"media_job_timeout":"media_job_incomplete",reviewRequired:true},deadline?504:502);
}
async function mediaStatus(request,env,user){
  const key=request.headers.get("Idempotency-Key")||"";
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(key))return fail("media_request_key_required",428,"Kunci permintaan media yang valid diperlukan.");
  try{
    const userHash=await sha256Hex(user.id);
    if(typeof env.MEDIA_LIMITER?.limit!=="function")throw new Error("Missing limiter");
    if((await env.MEDIA_LIMITER.limit({key:"media:status:"+userHash}))?.success!==true)
      return fail("media_rate_limited",429,"Terlalu banyak pemeriksaan status.",{"Retry-After":"60"});
    const id="media:"+await sha256Hex(JSON.stringify([user.id,key]));
    const row=await env.DB.prepare(`
      SELECT b.status AS budget_status,b.actual_micro_usd,
        c.status AS wallet_status,c.settled_microcredits,
        (SELECT COUNT(*) FROM media_usage_events d WHERE d.request_id=b.id AND d.event_kind='dispatched') AS dispatched,
        (SELECT COUNT(*) FROM media_usage_events m WHERE m.request_id=b.id AND m.event_kind='usage_measured') AS measured,
        (SELECT COALESCE(SUM(m.provider_cost_micro_usd),0) FROM media_usage_events m
          WHERE m.request_id=b.id AND m.event_kind='usage_measured') AS measured_cost
      FROM provider_budget_reservations b
      LEFT JOIN credit_reservations c ON c.request_id=b.id AND c.user_id=?
      WHERE b.id=?
    `).bind(user.id,id).first();
    if(!row)return fail("media_request_not_found",404,"Permintaan media tidak ditemukan untuk akun ini.");
    if(["dispatched","measured","measured_cost"].some(k=>!Number.isSafeInteger(row[k])||row[k]<0)||
      (row.settled_microcredits!==null&&row.settled_microcredits!==undefined&&
        (!Number.isSafeInteger(row.settled_microcredits)||row.settled_microcredits<0)))throw new Error("Invalid status");
    const cancelled=row.budget_status==="settled"&&row.actual_micro_usd===0&&row.dispatched===0&&
      (row.wallet_status==null||(row.wallet_status==="settled"&&row.settled_microcredits===0));
    const complete=row.budget_status==="settled"&&row.actual_micro_usd>0&&row.wallet_status==="settled"&&
      row.settled_microcredits>0&&row.dispatched>0&&row.dispatched===row.measured&&row.measured_cost===row.actual_micro_usd;
    return json({state:cancelled?"cancelled":complete?"completed":"unresolved",reviewRequired:!cancelled&&!complete,
      chargedMicrocredits:row.wallet_status==="settled"?String(row.settled_microcredits):"0",
      creditHeld:row.wallet_status==="reserved",outputStored:false});
  }catch{return fail("media_status_unavailable",503,"Status permintaan media belum dapat diperiksa.");}
}
export async function handleMediaRoute(request,env,url,dependencies){
  if(!["/api/media","/api/media/quote","/api/media/status"].includes(url.pathname))return null;
  if(env.MEDIA_API_ENABLED!=="true")return fail("media_unavailable",404,"Fitur media AI belum tersedia.");
  const milliseconds=env.MEDIA_HTTP_TIMEOUT_MS===undefined?120000:Number(env.MEDIA_HTTP_TIMEOUT_MS);
  if(!Number.isSafeInteger(milliseconds)||milliseconds<1||milliseconds>120000)
    return fail("media_runtime_unavailable",503,"Batas waktu layanan media belum tersedia.");
  const controller=new AbortController();let timer,stop;
  const halted=new Promise(resolve=>{stop=resolve});
  const interrupted=(code,status)=>{
    controller.abort();stop(json({error:"Proses media terhenti. Periksa status permintaan sebelum mengirim ulang.",code,reviewRequired:true},status));
  };
  const abort=()=>interrupted("media_request_cancelled",408);
  request.signal.addEventListener("abort",abort,{once:true});
  timer=setTimeout(()=>interrupted("media_request_timeout",504),milliseconds);
  if(request.signal.aborted)abort();
  try{
    const bounded=new Request(request,{signal:controller.signal});
    return await Promise.race([handleEnabledMediaRoute(bounded,env,url,dependencies),halted]);
  }catch{
    return fail("media_processing_unavailable",503,"Layanan media belum dapat memproses permintaan.");
  }finally{clearTimeout(timer);request.signal.removeEventListener("abort",abort);}
}
async function handleEnabledMediaRoute(request,env,url,{getSession,sameOrigin,runtime=env.MEDIA_RUNTIME}){
  if(request.method!=="POST")return fail("method_not_allowed",405,"Metode tidak didukung.",{Allow:"POST"});
  if(!sameOrigin(request)||request.headers.get("Sec-Fetch-Site")==="cross-site")
    return fail("invalid_origin",403,"Origin tidak valid.");
  let user;
  try{user=await getSession(request,env);}
  catch{return fail("media_auth_unavailable",503,"Sesi akun belum dapat diverifikasi.");}
  if(!user)return fail("media_auth_required",401,"Masuk ke akun untuk menggunakan fitur media AI.");
  if(url.pathname==="/api/media/status")return mediaStatus(request,env,user);
  if(env.PLAN_ENTITLEMENTS_ENABLED!=="true")return fail("media_unavailable",503,"Langganan media belum aktif.");
  try{
    const plan=await resolvePlanAccess(env,user.id);
    if(plan.plan==="free")return fail("media_plan_required",403,"Fitur media AI memerlukan langganan aktif.");
  }catch{return fail("media_plan_unavailable",503,"Paket aktif belum dapat diverifikasi.");}
  if(!ready(runtime)||typeof env.MEDIA_LIMITER?.limit!=="function")
    return fail("media_runtime_unavailable",503,"Layanan media belum siap digunakan.");
  const type=request.headers.get("Content-Type")||"";
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type))
    return fail("media_content_type",415,"Gunakan format application/json UTF-8.");
  if(request.headers.has("Content-Encoding")&&request.headers.get("Content-Encoding")!=="identity")
    return fail("media_content_encoding",415,"Unggahan terkompresi tidak didukung.");
  const isQuote=url.pathname.endsWith("/quote");
  let maximum;
  if(!isQuote){
    if(request.headers.get("X-BOR-Media-Consent")!=="send-to-ai")
      return fail("media_consent_required",428,"Setujui pengiriman media ke layanan AI sebelum memproses.");
    const amount=request.headers.get("X-BOR-Media-Max-Credits")||"";
    if(!creditPattern.test(amount)||BigInt(amount)>BigInt(Number.MAX_SAFE_INTEGER))
      return fail("media_credit_ceiling_required",428,"Setujui batas maksimum kredit dari estimasi terlebih dahulu.");
    maximum=BigInt(amount);
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(request.headers.get("Idempotency-Key")||""))
      return fail("media_request_key_required",428,"Kunci permintaan media yang valid diperlukan.");
  }
  let userHash;
  try{
    userHash=await sha256Hex(user.id);
    for(const key of ["media:user:"+userHash,"media:global"]){
      if((await env.MEDIA_LIMITER.limit({key}))?.success!==true)
        return fail("media_rate_limited",429,"Terlalu banyak permintaan media. Coba lagi nanti.",{"Retry-After":"60"});
    }
  }catch{return fail("media_limiter_unavailable",503,"Batas penggunaan media belum dapat diperiksa.");}
  const body=await readMediaJson(request,request.signal);
  if(body.response)return body.response;
  let operation,quote;
  try{operation=prepareMultimodalOperation(body.value);}
  catch{return fail("invalid_media_request",400,"Format, ukuran, atau parameter media tidak didukung.");}
  try{
    if((await authorizePlanFeature(env,user.id,operation.feature)).allowed!==true)
      return fail("media_plan_required",403,"Paket aktif tidak mendukung fitur ini.");
    quote=quoteMediaOperation(operation,runtime.tariffs[operation.model]);
  }catch{return fail("media_policy_unavailable",503,"Kebijakan akses atau biaya media belum dapat diverifikasi.");}
  if(!quote.allowed)return fail("media_job_limit",422,"Permintaan media melebihi batas pemakaian per proses.");
  if(isQuote)return json({feature:operation.feature,maximumMicrocredits:quote.reservedMicrocredits.toString(),
    callCount:operation.calls.length,estimateOnly:true,creditsReserved:false,providerInvoked:false});
  if(quote.reservedMicrocredits>maximum)return publicFailure({reason:"customer_credit_ceiling_exceeded"});
  const requestId=await sha256Hex(JSON.stringify([user.id,request.headers.get("Idempotency-Key")]));
  try{
    if(await env.DB.prepare("SELECT id FROM provider_budget_reservations WHERE id=?").bind("media:"+requestId).first())
      return fail("media_request_exists",409,"Permintaan ini sudah diterima. Jangan kirim ulang dengan kunci berbeda.");
  }catch{return fail("media_storage_unavailable",503,"Pencatatan permintaan media belum tersedia.");}
  // Mandatory trusted local decode/re-encode and moderation hooks. Quotes
  // never call these hooks or a provider. No raw media is persisted here.
  try{
    const intent=mediaIntent(body.value);
    if(request.signal.aborted)return fail("media_request_cancelled",408,"Proses media dibatalkan.");
    const preflight=await runtime.preflightInput({request:body.value,userId:user.id,signal:request.signal});
    if(request.signal.aborted)return fail("media_request_cancelled",408,"Proses media dibatalkan.");
    if(preflight?.ok!==true||!preflight.request)return fail("media_input_rejected",422,"Berkas media tidak lolos pemeriksaan.");
    prepareMultimodalOperation(preflight.request);
    if(mediaIntent(preflight.request)!==intent)return fail("media_input_rejected",422,"Parameter permintaan berubah saat pemeriksaan berkas.");
    // A configured callback's ok:true is not evidence of valid pixels.
    // Enforce the built-in bounded codec before moderation or any dispatch.
    const pixels=await verifyInputPixels({request:preflight.request,signal:request.signal});
    if(pixels.ok!==true)return fail("media_input_rejected",422,"Berkas media tidak lolos pemeriksaan piksel PNG.");
    freezeVerifiedRequest(pixels.request);
    if((await runtime.moderateInput({request:pixels.request,userId:user.id,signal:request.signal}))?.ok!==true)
      return fail("media_input_rejected",422,"Media tidak dapat diproses sesuai ketentuan layanan.");
    if(request.signal.aborted)return fail("media_request_cancelled",408,"Proses media dibatalkan.");
    if(mediaIntent(pixels.request)!==intent)return fail("media_input_rejected",422,"Parameter permintaan berubah saat pemeriksaan berkas.");
    const result=await runMultimodalInferencePrototype({env,userId:user.id,requestId,
      request:pixels.request,tariffs:runtime.tariffs,maximumMicrocredits:maximum,
      invokeModel:runtime.invokeModel,measureUsage:runtime.measureUsage,
      validateOutput:createPngOutputValidator({moderate:runtime.validateOutput}),
      jobTimeoutMs:runtime.jobTimeoutMs,signal:request.signal});
    if(!result.ok)return publicFailure(result);
    return json({ok:true,feature:result.feature,outputs:result.outputs,
      chargedMicrocredits:result.customerDebitMicrocredits.toString(),
      ...(result.mode?{mode:result.mode,audioAnalyzed:false}:{})});
  }catch{return fail("media_processing_unavailable",503,"Media belum dapat diproses. Tidak ada hasil yang dapat diberikan.");}
}
