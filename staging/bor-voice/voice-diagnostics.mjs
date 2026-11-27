// Candidate metadata only. Never retain authorization, audio, transcript, SDP, raw response body or arbitrary headers.
import {validLiveId} from './live-offer.mjs';
const validSeconds=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1e9;
const stamp=v=>Number.isSafeInteger(v)&&v>0?v:null;
const token=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v)&&!/^sk[-_]/i.test(v)?v:null;
export function httpDiagnostic(response,phase,now=Date.now()){
  const headers=response?.headers;
  const retry=headers?.get?.('retry-after');
  const retryAfter=typeof retry==='string'&&(/^[0-9]{1,10}$/.test(retry)||/^[A-Z][a-z]{2}, [0-9]{2} [A-Z][a-z]{2} [0-9]{4} [0-9]{2}:[0-9]{2}:[0-9]{2} GMT$/.test(retry))?retry:null;
  return {phase:['create','attach','primary_upgrade'].includes(phase)?phase:'unknown',observedMs:stamp(now),httpStatus:Number.isInteger(response?.status)&&response.status>=100&&response.status<=599?response.status:null,requestId:token(headers?.get?.('x-request-id')),retryAfter};
}
export function providerHttpError(message,response,phase){
  const error=new Error(message);
  error.diagnostic=httpDiagnostic(response,phase);
  error.upstreamStatus=error.diagnostic.httpStatus;
  return error;
}
export function usageEvidence(previous,event,sessionId,now=Date.now()){
  if(!validLiveId(sessionId)||!stamp(now)||!['session.usage.updated','session.closed'].includes(event?.type))return previous;
  if(event.session&&(event.session.id!==sessionId||event.session.model!=='gpt-live-1.1'))return previous;
  if(event.type==='session.closed'&&(!event.session||event.session.id!==sessionId||event.session.model!=='gpt-live-1.1'))return previous;
  if(previous?.terminal||!validSeconds(event.usage?.seconds)||(previous?.seconds!=null&&event.usage.seconds<previous.seconds))return previous;
  return {sessionId,seconds:event.usage.seconds,observedMs:now,terminal:event.type==='session.closed',endReason:event.type==='session.closed'?token(event.reason??event.session?.end_reason):null};
}
export function settlementEvidence(row,{sessionId,latestSeconds,diagnostic,startedMs,endedMs}){
  const out={};
  if(validLiveId(sessionId))out.sessionId=sessionId;
  if(validSeconds(latestSeconds))out.latestSeconds=latestSeconds;
  if(stamp(startedMs))out.startedMs=startedMs;
  if(stamp(endedMs))out.endedMs=endedMs;
  if(diagnostic&&['create','attach','primary_upgrade'].includes(diagnostic.phase)){
    const headers={get:k=>k==='retry-after'?diagnostic.retryAfter:k==='x-request-id'?diagnostic.requestId:null};
    out.diagnostic=httpDiagnostic({status:diagnostic.httpStatus,headers},diagnostic.phase,diagnostic.observedMs);
  }
  return {...row,...out};
}
