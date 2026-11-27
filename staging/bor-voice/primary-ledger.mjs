import {settlementEvidence} from './voice-diagnostics.mjs';
import {mergePrimaryEvidence,endReason} from './primary-evidence.mjs';
// Candidate Durable Object ledger adapter. The existing legacy record remains unchanged. assessExposure must be the server-owned assessVoiceExposure implementation. No production route is mounted here.
export function createPrimaryLedger({storage,assessExposure,providerMaxSeconds,now=Date.now}){
 const key='primary-voice-ledger-v1';
 return {
  async reserve({userId,attemptId}){
   if(typeof userId!=='string'||!userId||userId.length>128||typeof attemptId!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(attemptId))return{ok:false,reason:'invalid_identity'};
   return storage.transaction(async tx=>{
    // Legacy state must be installed by a trusted operator with verified closure
    // and a conservative upper cost; no browser route may write this evidence.
    const legacy=await tx.get('primary-legacy-evidence-v1');
    const rows=(await tx.get(key))??[];
    if(!Array.isArray(rows)||rows.length>=3)return{ok:false,reason:'global_limit'};
    if(rows.some(r=>r.attemptId===attemptId))return{ok:false,reason:'duplicate'};
    const day=new Date(now()).toISOString().slice(0,10);
    if(rows.some(r=>r.userId===userId&&r.day===day))return{ok:false,reason:'user_limit'};
    const assessment=assessExposure({providerMaxSeconds,legacy,ledger:rows});
    if(!assessment.allowed)return{ok:false,reason:assessment.reason};
    const row={attemptId,userId,day,state:'reserved',reservedMicrousd:100000,createdMs:now()};
    await tx.put(key,[...rows,row]);return{ok:true,attemptId};
   });
  },
  async recordEvidence({attemptId,...snapshot}){
   return storage.transaction(async tx=>{
    const rows=await tx.get(key);if(!Array.isArray(rows))throw Error('missing_ledger');
    const at=rows.findIndex(r=>r.attemptId===attemptId);if(at<0)throw Error('missing_attempt');
    const next=mergePrimaryEvidence(rows[at],snapshot);
    if(next!==rows[at])await tx.put(key,rows.map((r,i)=>i===at?next:r));
    return true;
   });
  },
  async readEvidenceRows(){
   return storage.transaction(async tx=>{const rows=(await tx.get(key))??[];if(!Array.isArray(rows)||rows.length>3)throw Error('invalid_ledger');return rows;});
  },
  async settle({attemptId,confirmed,sessionId,usage,latestSeconds,diagnostic,startedMs,endedMs,reason}){
   return storage.transaction(async tx=>{
    const rows=await tx.get(key);
    if(!Array.isArray(rows))throw Error('missing_ledger');
    const at=rows.findIndex(r=>r.attemptId===attemptId);if(at<0)throw Error('missing_attempt');
    const row=rows[at];if(row.state==='closed'||row.state==='unconfirmed')return row;
    const identityOk=(!row.sessionId||row.sessionId===sessionId)&&(!row.startedMs||row.startedMs===startedMs);
    const snapshotOk=latestSeconds===null||(typeof latestSeconds==='number'&&Number.isFinite(latestSeconds)&&latestSeconds>=0&&latestSeconds<=1e9);
    const floor=Math.max(row.latestSeconds??0,snapshotOk?(latestSeconds??0):0);
    const valid=confirmed===true&&identityOk&&snapshotOk&&typeof sessionId==='string'&&/^live_[A-Za-z0-9_-]{1,128}$/.test(sessionId)&&typeof usage?.seconds==='number'&&Number.isFinite(usage.seconds)&&usage.seconds>=floor&&usage.seconds<=1000000;
    const evidence=settlementEvidence(row,{sessionId:identityOk?sessionId:null,latestSeconds:identityOk&&snapshotOk&&(latestSeconds??-1)>=(row.latestSeconds??0)?latestSeconds:null,diagnostic,startedMs:identityOk?startedMs:null,endedMs});
    const next={...evidence,state:valid?'closed':'unconfirmed',...(valid?{sessionId,finalSeconds:usage.seconds,endReason:endReason(reason),actualMicrousd:Math.ceil(Math.max(15,usage.seconds)*50000/60)}:{}),settledMs:now()};
    await tx.put(key,rows.map((r,i)=>i===at?next:r));return next;
   });
  }
 }
}
