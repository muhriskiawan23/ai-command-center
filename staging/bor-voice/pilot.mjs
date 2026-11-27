// Offline integration harness. No real provider network capability is included.
import {PLAN} from './budget.mjs';
import {RecoveryJournal} from './recovery.mjs';
const validId = id=>typeof id==='string' && /^live_[A-Za-z0-9_-]{1,128}$/.test(id);
export function buildOffer(sdp){
  if(typeof sdp!=='string'||sdp.length>65536||!/^v=0\r?\n/.test(sdp))throw Error('invalid_offer');
  return {session:{model:PLAN.model,store:false,instructions:'You are BOR AI Voice. Speak naturally in the user’s language. This pilot is conversation only; do not claim to search or perform external actions.',audio:{output:{voice:'marin'}},delegation:{type:'client'},client:{data_channel:{allowed_client_events:['session.close'],allowed_server_events:['session.started','session.closed']}}},transport:{type:'webrtc',sdp}};
}
// Bounded local wait; a timeout is NOT proof that provider billing stopped.
async function boundedHangup(hangup, id, ms) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(()=>hangup(id)),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(false),ms)})
    ]) === true;
  } catch { return false; }
  finally { clearTimeout(timer); }
}
export class OfflinePilot {
  constructor({ledger,simulation,clock=Date.now,schedule=setTimeout,cancel=clearTimeout,closeWaitMs=3000,createWaitMs=15000}){
    if(!simulation||typeof simulation.create!=='function'||typeof simulation.hangup!=='function')throw Error('simulation_required');
    if(!Number.isInteger(closeWaitMs)||closeWaitMs<1||closeWaitMs>30000)throw Error('invalid_close_wait');
    if(!Number.isInteger(createWaitMs)||createWaitMs<1||createWaitMs>30000)throw Error('invalid_create_wait');
    Object.assign(this,{ledger,simulation,clock,schedule,cancel,closeWaitMs,createWaitMs});this.journal=new RecoveryJournal(ledger);this.active=null;
  }
  async start(id,sdp){
    if(this.active)throw Error('session_in_progress');
    const offer=buildOffer(sdp), reservation=this.ledger.reserve(id,this.clock());
    const s={id,reservation,providerId:null,closing:false,timer:null,closePromise:null};this.active=s;
    s.timer=this.schedule(()=>{if(this.active===s)void this.stop()},PLAN.stopAfterMs);
    let waitTimer;
    // Keep the operation observed even if the caller times out. A late known identity
    // must still be journaled and closed. Never free the reservation on timeout.
    const operation=this.completeCreate(s,offer);
    try {
      return await Promise.race([operation,new Promise((_,reject)=>{
        waitTimer=setTimeout(()=>{void this.stop().catch(()=>{});reject(Error('create_timeout'));},this.createWaitMs);
      })]);
    } finally {clearTimeout(waitTimer);}
  }
  async completeCreate(s,offer){
    const {id,reservation}=s;
    try{
      const answer=await this.simulation.create(offer);
      if(!validId(answer?.session?.id))throw Error('unconfirmed_identity');
      s.providerId=answer.session.id;
      this.journal.attach(id,s.providerId);
      if(s.closing||this.ledger.shouldHangup(id,this.clock())||answer.transport?.type!=='webrtc'||typeof answer.transport.sdp!=='string'||!/^v=0\r?\n/.test(answer.transport.sdp)||answer.transport.sdp.length>65536){await this.stop();throw Error('session_not_exposed');}
      return {id,answerSdp:answer.transport.sdp,deadlineMs:reservation.deadlineMs};
    }catch(e){await this.stop();throw e;}
  }
  async stop(){
    const s=this.active;if(!s)return 'no_session';
    s.closing=true;this.cancel(s.timer);
    if(!s.providerId)return 'awaiting_identity';
    if(!s.closePromise)s.closePromise=boundedHangup(id=>this.simulation.hangup(id),s.providerId,this.closeWaitMs).then(ok=>ok?'awaiting_final_usage':'unconfirmed');
    return s.closePromise;
  }
  // Only a trusted adapter may call this. Never wire it to browser input.
  finalEvent(event){
    const s=this.active;if(!s||event?.session?.id!==s.providerId)return false;
    const cost=this.journal.settle(event);this.cancel(s.timer);this.active=null;return {cost};
  }
  async recover(){if(this.active)throw Error('session_in_progress');return this.journal.recover(id=>boundedHangup(providerId=>this.simulation.hangup(providerId),id,this.closeWaitMs));}
  status(){return this.ledger.snapshot()}
}
