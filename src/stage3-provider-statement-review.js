// INACTIVE Stage 3: read-only internal AI usage aggregation for later,
// independently authenticated provider statement reconciliation. THIS DOES NOT
// certify actual Cloudflare neurons, invoices, payment or commercial pricing.
const MAX_MICRO = Number.MAX_SAFE_INTEGER;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const MODEL_ID = /^[A-Za-z0-9@][A-Za-z0-9._:@/-]{0,199}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SQL = `
SELECT date(d.created_at,'unixepoch') AS utc_day,
       d.provider, d.model,
       COUNT(*) AS dispatched_attempts,
       SUM(CASE WHEN EXISTS (
          SELECT 1 FROM provider_usage_events m
          WHERE m.attempt_id=d.attempt_id AND m.event_kind='usage_measured'
       ) THEN 1 ELSE 0 END) AS measured_attempts,
       SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM provider_usage_events m
          WHERE m.attempt_id=d.attempt_id AND m.event_kind='usage_measured'
       ) THEN 1 ELSE 0 END) AS unresolved_attempts,
       COALESCE(SUM((
          SELECT m.provider_cost_micro_usd FROM provider_usage_events m
          WHERE m.attempt_id=d.attempt_id AND m.event_kind='usage_measured'
       )),0) AS internal_cost_micro_usd
FROM provider_usage_events d
WHERE d.event_kind='dispatched' AND d.created_at>=? AND d.created_at<?
GROUP BY date(d.created_at,'unixepoch'),d.provider,d.model
ORDER BY utc_day,d.provider,d.model
`;

function dayToSeconds(day) {
  if (typeof day !== "string" || !DAY.test(day)) throw new TypeError("YYYY-MM-DD UTC date required");
  const timestamp=Date.parse(day+"T00:00:00Z");
  if (!Number.isSafeInteger(timestamp) ||
      new Date(timestamp).toISOString().slice(0,10)!==day)
    throw new TypeError("Valid UTC date required");
  return timestamp/1000;
}
function nonnegative(value){return Number.isSafeInteger(value)&&value>=0&&value<=MAX_MICRO;}
function rowKey(row){return row.utcDay+"|"+row.provider+"|"+row.model;}
function validIdentity(row){
  return row && typeof row==="object" &&
    typeof row.utcDay==="string" && DAY.test(row.utcDay) &&
    typeof row.provider==="string" && ID.test(row.provider) &&
    typeof row.model==="string" && MODEL_ID.test(row.model);
}
function checkInternalRow(row){
  if(!validIdentity(row)||
     !nonnegative(row.dispatchedAttempts)||!nonnegative(row.measuredAttempts)||
     !nonnegative(row.unresolvedAttempts)||!nonnegative(row.internalCostMicroUsd)||
     row.measuredAttempts+row.unresolvedAttempts!==row.dispatchedAttempts)
    throw new Error("Invalid or inconsistent internal provider usage aggregate");
}
function checkStatementRow(row){
  if(!validIdentity(row)||!nonnegative(row.statementCostMicroUsd))
    throw new TypeError("Exact integer provider statement cost and model/day required");
}
// Bound report footprint and avoid exposing per-user/request/attempt data.
// The query groups by UTC DISPATCH DAY. Actual provider billable day may differ:
// that difference must be resolved by a separate, independently verified audit.
export async function inspectStage3InternalDailyCosts(env,{
  startUtcDay,endUtcDay
}={}){
  if(!env?.DB?.prepare || typeof env.DB.prepare!=="function")
    throw new TypeError("D1 binding required for read-only internal cost audit");
  const start=dayToSeconds(startUtcDay);
  const end=dayToSeconds(endUtcDay);
  if(end<=start || end-start>31*86400)
    throw new RangeError("Date window must be >0 and at most 31 UTC days");
  const res=await env.DB.prepare(SQL).bind(start,end).all();
  if(!Array.isArray(res?.results)||res.results.length>200)
    throw new Error("Incomplete or excessive internal provider snapshot");
  const rows=res.results.map(row=>{
    const value={
      utcDay:row.utc_day,provider:row.provider,model:row.model,
      dispatchedAttempts:row.dispatched_attempts,
      measuredAttempts:row.measured_attempts,
      unresolvedAttempts:row.unresolved_attempts,
      internalCostMicroUsd:row.internal_cost_micro_usd
    };
    checkInternalRow(value);
    return Object.freeze(value);
  });
  if(new Set(rows.map(rowKey)).size!==rows.length)
    throw new Error("Duplicate internal provider aggregation key");
  return Object.freeze({
    rows:Object.freeze(rows),
    scope:"inactive_stage3_internal_costs_only",
    providerInvoiceVerified:false,
    operatorActionAuthorized:false
  });
}

// Offline arithmetic comparison only. The caller MUST obtain the source
// statement via separate authenticated means. Neither equality nor a caller
// claiming "verified" can validate a provider's invoice provenance.
export function compareStage3ProviderStatement({internalSnapshot,statementRows}={}){
  if(!internalSnapshot ||
     internalSnapshot.scope!=="inactive_stage3_internal_costs_only"||
     internalSnapshot.providerInvoiceVerified!==false||
     !Array.isArray(internalSnapshot.rows) ||
     !Array.isArray(statementRows) ||
     internalSnapshot.rows.length>200 || statementRows.length>200)
    throw new TypeError("Bounded unverified journal and statement rows required");
  const journal=new Map();
  const invoice=new Map();
  for(const row of internalSnapshot.rows){
    checkInternalRow(row);
    const key=rowKey(row);
    if(journal.has(key))throw new Error("Duplicate internal journal aggregation");
    journal.set(key,row);
  }
  for(const row of statementRows){
    checkStatementRow(row);
    const key=rowKey(row);
    if(invoice.has(key))throw new Error("Duplicate provider statement key");
    invoice.set(key,row);
  }
  let matched=0,missingStatement=0,unexpectedStatement=0,costMismatch=0,unresolved=0;
  for(const [key,row] of journal){
    if(row.unresolvedAttempts>0)unresolved+=row.unresolvedAttempts;
    const cost=invoice.get(key);
    if(!cost){missingStatement++;continue;}
    if(row.internalCostMicroUsd===cost.statementCostMicroUsd)matched++;
    else costMismatch++;
  }
  for(const key of invoice.keys())if(!journal.has(key))unexpectedStatement++;
  const arithmeticMatch=missingStatement===0 && unexpectedStatement===0 &&
    costMismatch===0 && unresolved===0 && journal.size>0;
  return Object.freeze({
    scope:"inactive_stage3_statement_arithmetic_only",
    matchedGroups:matched,missingStatementGroups:missingStatement,
    unexpectedStatementGroups:unexpectedStatement,
    mismatchedCostGroups:costMismatch,unresolvedAttempts:unresolved,
    arithmeticMatch,
    reviewRequired:!arithmeticMatch,
    providerInvoiceVerified:false,operatorActionAuthorized:false,
    instruction:"Require provider-authenticated invoice provenance, neuron/billable unit validation, independent review and explicit founder approval. Never auto-settle."
  });
}
