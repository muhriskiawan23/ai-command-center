// Synthetic sessions only. Never reads the production database or creates a voice session.
export async function runSessionContract({getSession,sha256Hex,voiceAdmissionStatus,service}) {
 const token='fixture-only-not-a-real-cookie', hash=await sha256Hex(token);
 const fixture={id:'qa-google-user',email:'fixture@example.invalid',name:'Fixture',picture:''};
 let calls=0, reads=0, sqlValid=true, noForwardedIdentity=true;
 const voice={fetch:async(url,init)=>{
   calls++;
   if(url!=='https://voice-status.internal/api/voice/session/status'||init.method!=='GET'||init.headers||init.body){noForwardedIdentity=false;throw Error('unsafe_service_request');}
   return service.fetch(url,init);
 }};
 const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...extra}});
 const makeDB=(expires,revoked=false)=>({prepare(sql){
   reads++;sqlValid&&=sql.includes('JOIN users ON users.id = sessions.user_id')&&sql.includes('sessions.token_hash = ? AND sessions.expires_at > ?');
   return {bind(value,now){return {first:async()=>!revoked&&value===hash&&expires>now?fixture:null};}};
 }});
 const now=Math.floor(Date.now()/1000);
 const call=(cookie,db,method='GET')=>voiceAdmissionStatus(new Request('https://fixture.invalid/api/voice/admission/status',{method,headers:{...(cookie?{Cookie:'__Host-borai_session='+cookie}:{}),'X-User-Id':'qa-google-user'}}),{DB:db,BOR_VOICE_STATUS:voice},{getSession,json});
 const checks={};
 checks.guestDenied=(await call('',makeDB(now+600))).status===401&&reads===0&&calls===0;
 checks.forgedCookieDenied=(await call('forged',makeDB(now+600))).status===401&&calls===0;
 checks.expiredDenied=(await call(token,makeDB(now-1))).status===401&&calls===0;
 checks.revokedDenied=(await call(token,makeDB(now+600,true))).status===401&&calls===0;
 checks.databaseOutageDenied=(await call(token,undefined)).status===503&&calls===0;
 checks.postDenied=(await call(token,makeDB(now+600),'POST')).status===405&&calls===0;
 const result=await call(token,makeDB(now+600));const data=await result.json();
 checks.verifiedSessionStatus=result.status===200&&data.authenticated===true&&typeof data.sessionState==='string'&&calls===1;
 checks.paidAdmissionLocked=data.ready===false;
 checks.noIdentityLeak=noForwardedIdentity&&!JSON.stringify(data).includes(fixture.id)&&!JSON.stringify(data).includes(fixture.email)&&!JSON.stringify(data).includes(token);
 checks.hashedSessionAndExpiry=sqlValid&&reads===4;
 return {checks,passed:Object.values(checks).filter(Boolean).length,total:Object.keys(checks).length,sessionState:data.sessionState??null,actualGoogleLoginTested:false,paidAdmission:false};
}
