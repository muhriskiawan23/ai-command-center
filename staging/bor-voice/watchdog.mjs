// Local-only lifecycle harness. Transport is injected; no network adapter is shipped.
import {PLAN} from './budget.mjs';
export class VoiceWatchdog {
  constructor({ledger,transport,clock=Date.now,schedule=setTimeout,cancel=clearTimeout}) {
    Object.assign(this,{ledger,transport,clock,schedule,cancel}); this.current=null;
  }
  start(id) {
    if(this.current) throw Error('session_in_progress');
    const reservation=this.ledger.reserve(id,this.clock());
    const s={id,deadline:reservation.deadlineMs,state:'starting',timer:null,providerId:null};
    this.current=s;
    s.timer=this.schedule(()=>{void this.stop('deadline')},PLAN.stopAfterMs);
    return reservation;
  }
  async attached(id,providerId) {
    const s=this.current;
    if(!s||s.id!==id||s.providerId||typeof providerId!=='string'||!providerId.trim()) throw Error('unexpected_attachment');
    s.providerId=providerId;
    if(s.state==='closing'||this.clock()>=s.deadline||this.ledger.shouldHangup(id,this.clock())) {
      s.state='closing'; return this.requestClose(s);
    }
    s.state='active'; return 'active';
  }
  async stop(reason='user') {
    const s=this.current;if(!s)return 'no_session';
    s.state='closing';s.reason=reason;this.cancel(s.timer);
    return s.providerId?this.requestClose(s):'awaiting_provider_identity';
  }
  async requestClose(s) {
    if(s.closeRequested)return 'already_requested';
    s.closeRequested=true;
    try{await this.transport.hangup(s.providerId);return 'awaiting_final_usage'}
    catch{if(this.current===s)s.state='uncertain';return 'hangup_unconfirmed'}
  }
  // Caller must be a trusted authenticated provider adapter, never a browser event.
  providerEvent(providerId,event) {
    const s=this.current;if(!s||!s.providerId||s.providerId!==providerId)return false;
    if(event?.type!=='session.closed')return false;
    const cost=this.ledger.confirmClosed(s.id,event);
    this.cancel(s.timer);this.current=null;return {cost};
  }
}
