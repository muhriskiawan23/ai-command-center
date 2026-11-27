// All amounts are integer micro-USD. Never convert missing evidence to zero.
export function normalizeUsage(usage){
 const total=usage?.seconds,active=usage?.active_seconds,paused=usage?.paused_seconds;
 if(typeof total!=='number'||!Number.isFinite(total)||total<0||total>1e9)return null;
 if(active===undefined&&paused===undefined)return {seconds:total,upperMicrousd:Math.ceil(total*50000/60),exactMicrousd:null};
 if(![active,paused].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0)||Math.abs(active+paused-total)>0.001)return null;
 return {seconds:total,activeSeconds:active,pausedSeconds:paused,upperMicrousd:Math.ceil(total*50000/60),exactMicrousd:Math.ceil((active*50000+paused*20000)/60)};
}
export function observeUsage(record,event){
 if(!record||typeof record.sessionId!=='string'||record.model!=='gpt-live-1.1'||record.final)return record;
 if(event?.type!=='session.usage.updated'&&event?.type!=='session.closed')return record;
 // The provider-side observer must be bound to this session by its trusted transport.
 if(event.type==='session.closed'&&(event.session?.id!==record.sessionId||event.session?.model!==record.model))return record;
 const usage=normalizeUsage(event.usage);
 if(!usage||usage.seconds<(record.latest?.seconds??0))return record;
 return {...record,latest:usage,...(event.type==='session.closed'?{final:usage,finalization:'confirmed'}:{finalization:'pending'})};
}
export function disconnectUsage(record){return record.final?record:{...record,finalization:'unconfirmed'};}
export function admissionAfterSettlement(record){
 // Even confirmed voice-only usage does not attest separate delegated model/tool charges.
 if(!record?.final)return {allowed:false,reason:'unconfirmed'};
 if(record.final.upperMicrousd>record.reservedMicrousd)return {allowed:false,reason:'overrun'};
 return {allowed:false,reason:'provider_limit_and_global_ledger_not_verified'};
}
