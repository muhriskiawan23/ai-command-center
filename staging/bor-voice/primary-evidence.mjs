// Candidate server-only evidence persistence and read-only export. No provider calls.
import {validLiveId} from './live-offer.mjs';
import {settlementEvidence} from './voice-diagnostics.mjs';
const time=x=>Number.isSafeInteger(x)&&x>0;
const seconds=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e9;
export const endReason=x=>['connection_lost','expired'].includes(x)?x:null;
export function mergePrimaryEvidence(row,snapshot){
 if(row?.state!=='reserved'||!validLiveId(snapshot?.sessionId)||!time(snapshot.startedMs)||!time(snapshot.observedMs)||snapshot.observedMs<snapshot.startedMs)throw Error('invalid_evidence');
 if((row.sessionId&&row.sessionId!==snapshot.sessionId)||(row.startedMs&&row.startedMs!==snapshot.startedMs))throw Error('identity_conflict');
 if(snapshot.latestSeconds!==null&&!seconds(snapshot.latestSeconds))throw Error('invalid_usage');
 if((row.latestObservedMs??0)>snapshot.observedMs||(seconds(row.latestSeconds)&&(snapshot.latestSeconds===null||snapshot.latestSeconds<row.latestSeconds)))return row;
 return {...row,sessionId:snapshot.sessionId,startedMs:snapshot.startedMs,latestObservedMs:snapshot.observedMs,...(seconds(snapshot.latestSeconds)?{latestSeconds:snapshot.latestSeconds}:{})};
}
// At most one pending snapshot and one transaction in flight. Every snapshot carries identity.
// Failure is sticky and closes the candidate session; it never releases the reservation.
export function makeEvidenceWriter({write,waitUntil,onFailure}){
 let pending=null,running=null,failed=false,sealed=false;
 function offer(snapshot){
  if(sealed||failed)return;
  pending=snapshot;
  if(running)return;
  running=Promise.resolve().then(async()=>{
   try{while(pending){const next=pending;pending=null;if(await write(next)!==true)throw Error('evidence_write_failed');}}
   catch{failed=true;pending=null;try{onFailure()}catch{}}
   finally{running=null;}
  });
  waitUntil(running);
 }
 return {offer,async drain(){sealed=true;while(running)await running;return !failed;}};
}
export function projectEvidence(row){
 const safe=settlementEvidence({},row??{});
 return {attemptId:typeof row?.attemptId==='string'&&/^[A-Za-z0-9_-]{16,128}$/.test(row.attemptId)?row.attemptId:null,
  state:['reserved','closed','unconfirmed'].includes(row?.state)?row.state:'unknown',
  ...safe,latestObservedMs:time(row?.latestObservedMs)?row.latestObservedMs:null,
  finalSeconds:row?.state==='closed'&&seconds(row.finalSeconds)?row.finalSeconds:null,
  endReason:endReason(row?.endReason)};
}
// Must be mounted only behind the existing server-verified owner auth in isolated staging.
// No legacy KV access or reset; export is for new primary candidate attempts only.
export function makeOwnerEvidenceExport({getSession,ownerId,origin,readRows}){
 return async request=>{
  const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
  const url=new URL(request.url);
  if(url.origin!==origin||url.pathname!=='/api/voice/diagnostics'||url.search)return reply({error:'not_found'},404);
  if(request.method!=='GET')return reply({error:'method_not_allowed'},405);
  if(request.headers.get('Origin')&&request.headers.get('Origin')!==origin)return reply({error:'forbidden'},403);
  let user;try{user=await getSession(request)}catch{return reply({error:'auth_unavailable'},503);}
  if(!user||typeof ownerId!=='string'||!ownerId||String(user.id)!==ownerId)return reply({error:'forbidden'},403);
  try{const rows=await readRows();if(!Array.isArray(rows)||rows.length>3)return reply({error:'unavailable'},503);
   return reply({scope:'primary_candidate',legacy:'not_exported',records:rows.map(projectEvidence)});
  }catch{return reply({error:'unavailable'},503);}
 };
}
