// Staging-only admission contract. No provider calls, no public reserve endpoint.
export const VOICE_POLICY=Object.freeze({"reserveMicrousd":100000,"poolMicrousd":300000,"maxAttempts":3,"perUserPerUtcDay":1,"targetSeconds":60});
export function validVoiceUser(id){return (typeof id==="string"&&id.length>0&&id.length<=128&&!/[\x00-\x1f\x7f]/.test(id))||(Number.isSafeInteger(id)&&id>0);}

export async function voiceAdmissionStatus(request,env,{getSession,json}){
 if(request.method!=="GET")return json({error:"method_not_allowed"},405,{Allow:"GET"});
 let user;try{user=await getSession(request,env);}catch{return json({error:"voice_auth_unavailable"},503);}
 if(!validVoiceUser(user?.id))return json({error:"voice_auth_required"},401);
 // Read-only readiness endpoint; never allocates, calls OpenAI, or exposes a user identifier.
 return json({ready:false,reason:"voice_paid_disabled_pending_verified_provider_limit_and_reconciliation",policy:VOICE_POLICY});
}

export function voiceReservation(rows,{userId,attemptId,nowMs}){
 if(!validVoiceUser(userId)||typeof attemptId!=="string"||!/^[A-Za-z0-9_-]{16,128}$/.test(attemptId)||!Number.isSafeInteger(nowMs)||nowMs<0||nowMs>8640000000000000)throw Error("invalid_voice_reservation");
 if(!Array.isArray(rows)||rows.length>VOICE_POLICY.maxAttempts||rows.some(r=>!r||!["reserved","closed"].includes(r.state)||!Number.isSafeInteger(r.reservedMicrousd)||r.reservedMicrousd!==VOICE_POLICY.reserveMicrousd||(r.state==="closed"&&(!Number.isSafeInteger(r.actualMicrousd)||r.actualMicrousd<0))))throw Error("invalid_voice_ledger");
 if(rows.some(r=>r.attemptId===attemptId))return {ok:false,reason:"duplicate"};
 if(rows.some(r=>r.state!=="closed"||r.actualMicrousd>r.reservedMicrousd))return {ok:false,reason:"unconfirmed_or_overrun"};
 const day=new Date(nowMs).toISOString().slice(0,10),user=String(userId);
 if(rows.filter(r=>r.user===user&&r.day===day).length>=VOICE_POLICY.perUserPerUtcDay)return {ok:false,reason:"user_limit"};
 if(rows.length>=VOICE_POLICY.maxAttempts||(rows.length+1)*VOICE_POLICY.reserveMicrousd>VOICE_POLICY.poolMicrousd)return {ok:false,reason:"global_limit"};
 const row={attemptId,user,day,state:"reserved",reservedMicrousd:VOICE_POLICY.reserveMicrousd,createdMs:nowMs,deadlineMs:nowMs+VOICE_POLICY.targetSeconds*1000};
 return {ok:true,row,rows:[...rows,row]};
}

export async function reserveVoiceAtomic(storage,input){
 return storage.transaction(async tx=>{
  const rows=(await tx.get("voice-admission-ledger-v1"))??[];
  const result=voiceReservation(rows,input);
  if(result.ok)await tx.put("voice-admission-ledger-v1",result.rows);
  return result.ok?{ok:true,attemptId:result.row.attemptId,deadlineMs:result.row.deadlineMs,reservedMicrousd:result.row.reservedMicrousd}:result;
 });
}
