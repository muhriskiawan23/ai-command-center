// Offline reference for a durable recovery journal. Requires the same SQLite
// database as PilotLedger. Only a trusted server may call these methods.
import {upperEstimate, PLAN} from './budget.mjs';
const validProviderId = id => typeof id === 'string' && /^live_[A-Za-z0-9_-]{1,128}$/.test(id);
export class RecoveryJournal {
  constructor(ledger) {
    this.ledger=ledger; this.db=ledger.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS provider_sessions (attempt_id TEXT PRIMARY KEY, provider_id TEXT UNIQUE NOT NULL, close_attempts INTEGER NOT NULL DEFAULT 0, last_status TEXT NOT NULL DEFAULT 'attached');`);
  }
  attach(id, providerId) {
    if(!validProviderId(providerId)) throw Error('invalid_provider_id');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const a=this.db.prepare('SELECT status FROM attempts WHERE id=?').get(id);
      if(a?.status!=='reserved') throw Error('unknown_attempt');
      const old=this.db.prepare('SELECT provider_id FROM provider_sessions WHERE attempt_id=?').get(id);
      if(old && old.provider_id!==providerId) throw Error('identity_conflict');
      if(!old) this.db.prepare('INSERT INTO provider_sessions(attempt_id,provider_id) VALUES (?,?)').run(id,providerId);
      this.db.exec('COMMIT');
    } catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  pending(){return this.db.prepare(`SELECT a.id,a.started_ms,p.provider_id,p.close_attempts FROM attempts a LEFT JOIN provider_sessions p ON a.id=p.attempt_id WHERE a.status='reserved'`).all();}
  async recover(hangup) {
    const result=[];
    // Call only at server boot after obtaining an exclusive recovery lease;
    // existing sessions are closed rather than resumed after an unclean restart.
    for(const a of this.pending()) {
      if(!a.provider_id){result.push({id:a.id,status:'identity_unknown'});continue;}
      const claim=this.db.prepare(`UPDATE provider_sessions SET close_attempts=close_attempts+1,last_status='requesting' WHERE attempt_id=? AND close_attempts<2 AND EXISTS(SELECT 1 FROM attempts WHERE id=? AND status='reserved')`).run(a.id,a.id);
      if(!claim.changes){result.push({id:a.id,status:'recovery_exhausted'});continue;}
      let status='unconfirmed';
      try {const r=await hangup(a.provider_id);if(r===true)status='awaiting_final_event';}catch{}
      this.db.prepare('UPDATE provider_sessions SET last_status=? WHERE attempt_id=?').run(status,a.id);
      result.push({id:a.id,status});
    }
    return result;
  }
  settle(event){
    // Event must come from a trusted provider connection, not a browser.
    if(event?.type!=='session.closed'||!validProviderId(event.session?.id)||event.session?.model!==PLAN.model||!Number.isFinite(event.usage?.seconds)||event.usage.seconds<0) throw Error('invalid_final_event');
    upperEstimate(event.usage.seconds);
    const p=this.db.prepare('SELECT attempt_id FROM provider_sessions WHERE provider_id=?').get(event.session.id);
    if(!p) throw Error('unknown_provider_session');
    return this.ledger.confirmClosed(p.attempt_id,event);
  }
}
// Transport contract only; caller supplies mock fetch. No default network fetch,
// no key lookup, no session creation. A 2xx is not final billing confirmation.
export function makeHangup({fetchImpl,token}){
  if(typeof fetchImpl!=='function'||typeof token!=='string'||!token||/[\r\n]/.test(token))throw Error('invalid_config');
  return async id=>{
    if(!validProviderId(id))throw Error('invalid_provider_id');
    const r=await fetchImpl(`https://api.openai.com/v1/live/sessions/${encodeURIComponent(id)}/hangup`,{method:'POST',headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(3000)});
    return r?.ok===true;
  };
}
