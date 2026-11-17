// Stage 3 INACTIVE cross-ledger audit. Read-only and privacy-minimizing.
// This is NOT Cloudflare provider invoice/actual billing reconciliation.
// All three proposed schemas must exist; missing/incomplete data fails closed.
// Call only from an authorized operator/reviewer path, never an unauthenticated API.
const FIELDS=[
  "dispatchedAttempts","measuredAttempts","unknownUnmeasuredAttempts",
  "staleUnmeasuredAttempts","stalePreDispatchBudgetHolds",
  "orphanDispatches","providerModelMismatches",
  "settledBudgetWithoutMeasuredUsage","settledCostMismatches",
  "measuredBudgetStillHeld","measuredAboveReservedCeiling",
  "releasedCreditAfterMeasuredUsage","settledCreditWithoutMeasuredUsage",
  "multiAttemptRequests"
];
const query=[
"SELECT",
"(SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='dispatched') AS dispatchedAttempts,",
"(SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='usage_measured') AS measuredAttempts,",
"(SELECT COUNT(*) FROM provider_usage_events d",
" WHERE d.event_kind='dispatched'",
" AND NOT EXISTS (SELECT 1 FROM provider_usage_events m",
"    WHERE m.attempt_id=d.attempt_id AND m.event_kind='usage_measured')",
" AND EXISTS (SELECT 1 FROM provider_usage_events e",
"    WHERE e.attempt_id=d.attempt_id",
"      AND e.event_kind IN ('outcome_unknown','usage_unverified')))",
" AS unknownUnmeasuredAttempts,",
"(SELECT COUNT(*) FROM provider_usage_events d",
" WHERE d.event_kind='dispatched' AND d.created_at<=?",
" AND NOT EXISTS (SELECT 1 FROM provider_usage_events m",
"    WHERE m.attempt_id=d.attempt_id AND m.event_kind='usage_measured'))",
" AS staleUnmeasuredAttempts,",
"(SELECT COUNT(*) FROM provider_budget_reservations b",
" WHERE b.status='reserved' AND b.created_at<=?",
" AND EXISTS (SELECT 1 FROM credit_reservations c",
"   WHERE b.id='ai:' || c.request_id AND c.status='reserved')",
" AND NOT EXISTS (SELECT 1 FROM provider_usage_events d",
"   WHERE d.event_kind='dispatched' AND b.id='ai:' || d.request_id))",
" AS stalePreDispatchBudgetHolds,",
"(SELECT COUNT(*) FROM provider_usage_events d",
" WHERE d.event_kind='dispatched'",
" AND (NOT EXISTS (SELECT 1 FROM provider_budget_reservations b",
"     WHERE b.id='ai:' || d.request_id)",
"   OR NOT EXISTS (SELECT 1 FROM credit_reservations c",
"     WHERE c.request_id=d.request_id))) AS orphanDispatches,",
"(SELECT COUNT(*) FROM provider_usage_events d",
" JOIN provider_budget_reservations b ON b.id='ai:' || d.request_id",
" WHERE d.event_kind='dispatched'",
" AND (d.provider!=b.provider OR d.model!=b.model)) AS providerModelMismatches,",
"(SELECT COUNT(*) FROM provider_budget_reservations b",
" WHERE b.status='settled' AND b.actual_micro_usd>0",
" AND NOT EXISTS (SELECT 1 FROM provider_usage_events m",
"   WHERE m.event_kind='usage_measured' AND b.id='ai:' || m.request_id))",
" AS settledBudgetWithoutMeasuredUsage,",
"(SELECT COUNT(*) FROM provider_budget_reservations b",
" WHERE b.status='settled'",
" AND EXISTS (SELECT 1 FROM provider_usage_events m",
"   WHERE m.event_kind='usage_measured' AND b.id='ai:' || m.request_id)",
" AND b.actual_micro_usd!=",
"   (SELECT SUM(m.provider_cost_micro_usd) FROM provider_usage_events m",
"    WHERE m.event_kind='usage_measured' AND b.id='ai:' || m.request_id))",
" AS settledCostMismatches,",
"(SELECT COUNT(*) FROM provider_budget_reservations b",
" WHERE b.status='reserved'",
" AND EXISTS (SELECT 1 FROM provider_usage_events m",
"   WHERE m.event_kind='usage_measured' AND b.id='ai:' || m.request_id))",
" AS measuredBudgetStillHeld,",
"(SELECT COUNT(*) FROM provider_budget_reservations b",
" WHERE (SELECT COALESCE(SUM(m.provider_cost_micro_usd),0)",
"        FROM provider_usage_events m WHERE m.event_kind='usage_measured'",
"          AND b.id='ai:' || m.request_id)>b.reserved_micro_usd)",
" AS measuredAboveReservedCeiling,",
"(SELECT COUNT(*) FROM credit_reservations c",
" WHERE c.status='released'",
" AND EXISTS (SELECT 1 FROM provider_usage_events m",
"   WHERE m.event_kind='usage_measured' AND m.request_id=c.request_id))",
" AS releasedCreditAfterMeasuredUsage,",
"(SELECT COUNT(*) FROM credit_reservations c",
" WHERE c.status='settled' AND c.settled_microcredits>0",
" AND NOT EXISTS (SELECT 1 FROM provider_usage_events m",
"   WHERE m.event_kind='usage_measured' AND m.request_id=c.request_id))",
" AS settledCreditWithoutMeasuredUsage,",
"(SELECT COUNT(*) FROM (SELECT request_id FROM provider_usage_events",
" WHERE event_kind='dispatched' GROUP BY request_id HAVING COUNT(*)>1))",
" AS multiAttemptRequests"
].join(" ");

export async function inspectStage3CrossLedgerReconciliation(env,{
  nowMs=Date.now(),staleAfterSeconds=3600
}={}){
  if(!env?.DB?.prepare || typeof env.DB.prepare!=="function")
    throw new TypeError("D1 binding required for read-only Stage 3 audit");
  if(!Number.isSafeInteger(nowMs)||nowMs<0||
    !Number.isSafeInteger(staleAfterSeconds)||staleAfterSeconds<60)
    throw new TypeError("Valid audit clock and >=60s stale window required");
  const cutoff=Math.floor(nowMs/1000)-staleAfterSeconds;
  // A single SELECT gives one consistent SQLite snapshot even while other
  // requests are settling. No user/request/attempt identifiers are returned.
  // Do not catch missing tables, DB failures or malformed results.
  const row=await env.DB.prepare(query).bind(cutoff,cutoff).first();
  if(!row || FIELDS.some(k=>!Number.isSafeInteger(row[k])||row[k]<0))
    throw new Error("Stage 3 cross-ledger snapshot unavailable or invalid");
  const counts=Object.fromEntries(FIELDS.map(k=>[k,row[k]]));
  const issues=FIELDS.filter(k=>!["dispatchedAttempts","measuredAttempts"].includes(k));
  return {
    scope:"inactive_stage3_internal_cross_ledger_only",
    ...counts,
    reviewRequired:issues.some(k=>counts[k]>0),
    cutoffUtc:new Date(Math.max(0,cutoff)*1000).toISOString(),
    providerInvoiceVerified:false,
    liveBillingApproved:false
  };
}
