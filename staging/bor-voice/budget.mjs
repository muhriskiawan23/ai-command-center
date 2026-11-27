import { DatabaseSync } from 'node:sqlite';
import { LIVE_MODEL } from './live-offer.mjs';
export const PLAN = Object.freeze({model:LIVE_MODEL, ceiling:500000, voicePool:300000, backendPool:100000, contingency:100000, maxAttempts:3, reservePerAttempt:100000, stopAfterMs:60000, reserveSeconds:120});
// All costs are integer micro-USD. Treat all provider time as active ($0.05/min).
export function upperEstimate(seconds) {
  if(!Number.isFinite(seconds)||seconds<0||seconds>1e9) throw Error('invalid_usage');
  return Math.ceil(seconds*50000/60);
}
export class PilotLedger {
  constructor(path) {
    this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY, started_ms INTEGER NOT NULL, status TEXT NOT NULL, actual INTEGER);`);
  }
  reserve(id, now=Date.now()) {
    if(typeof id!=='string'||!id.trim()||id.length>128||!Number.isSafeInteger(now)||now<0) throw Error('invalid_request');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const rows=this.db.prepare('SELECT * FROM attempts').all();
      if(rows.some(r=>r.id===id)) throw Error('duplicate_attempt');
      if(rows.some(r=>r.status!=='closed')) throw Error('unconfirmed_session');
      if(rows.length>=PLAN.maxAttempts || (rows.length+1)*PLAN.reservePerAttempt>PLAN.voicePool) throw Error('attempt_limit');
      if(rows.some(r=>r.actual>PLAN.reservePerAttempt)) throw Error('reservation_exceeded');
      this.db.prepare('INSERT INTO attempts VALUES (?, ?, ?, NULL)').run(id,now,'reserved');
      this.db.exec('COMMIT');
      return {id, deadlineMs:now+PLAN.stopAfterMs, reservedMicrousd:PLAN.reservePerAttempt};
    } catch(e) {this.db.exec('ROLLBACK');throw e;}
  }
  shouldHangup(id, now=Date.now()) {
    const r=this.db.prepare('SELECT * FROM attempts WHERE id=?').get(id);
    if(!r || !Number.isSafeInteger(now) || now<r.started_ms) return true;
    return r.status!=='reserved'||now>=r.started_ms+PLAN.stopAfterMs;
  }
  // Only a trusted adapter receiving session.closed may call this. No client usage is trusted.
  confirmClosed(id, event) {
    if(event?.type!=='session.closed'||!Number.isFinite(event?.usage?.seconds)) throw Error('unconfirmed_usage');
    const amount=upperEstimate(event.usage.seconds);
    const result=this.db.prepare("UPDATE attempts SET status='closed',actual=? WHERE id=? AND status='reserved'").run(amount,id);
    if(result.changes!==1) throw Error('unknown_or_finalized');
    return amount;
  }
  snapshot(){const rows=this.db.prepare('SELECT * FROM attempts').all();return {attempts:rows.length,reservedMicrousd:rows.length*PLAN.reservePerAttempt, confirmedMicrousd:rows.reduce((a,r)=>a+(r.actual??0),0), blocked:rows.some(r=>r.status!=='closed'||r.actual>PLAN.reservePerAttempt)};}
  close(){this.db.close();}
}
// Offline staging preflight: do not use a provider until a server-side watchdog,
// durable shared ledger, authorization, verified close and backend limits are proven.
export function mayStartPaid({localSimulation=false}={}) {
  return localSimulation===true ? 'simulation_only' : 'blocked_pending_live_controls';
}
