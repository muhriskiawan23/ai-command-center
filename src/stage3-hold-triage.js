// INACTIVE Stage 3: read-only operator triage of measured AI usage, provider
// budget and customer wallet states. NO automatic settlement, refund or debit.
// Do not import in production routes without independent review.
const COUNTS = Object.freeze([
  "budgetReservations", "staleBudgetHolds", "stalePreDispatchDualHolds",
  "unknownProviderHolds", "unverifiedUsageHolds",
  "measuredPendingProviderSettlement", "creditFinalizationPending",
  "providerFinalizationPending", "settledWithoutMeasuredUsage",
  "settledMeasuredCostMismatch", "orphanWalletHolds",
  "orphanProviderBudgetHolds", "orphanJournalDispatches"
]);

const SQL = `
WITH journal AS (
 SELECT request_id,
   SUM(CASE WHEN event_kind='dispatched' THEN 1 ELSE 0 END) AS dispatched_count,
   SUM(CASE WHEN event_kind='usage_measured' THEN 1 ELSE 0 END) AS measured_count,
   SUM(CASE WHEN event_kind='outcome_unknown' THEN 1 ELSE 0 END) AS unknown_count,
   SUM(CASE WHEN event_kind='usage_unverified' THEN 1 ELSE 0 END) AS unverified_count,
   COALESCE(SUM(CASE WHEN event_kind='usage_measured' THEN provider_cost_micro_usd ELSE 0 END),0) AS measured_cost
 FROM provider_usage_events GROUP BY request_id
),
paired AS (
 SELECT b.id, b.status AS provider_status, b.actual_micro_usd,
        b.created_at, c.status AS wallet_status,
        COALESCE(j.dispatched_count,0) AS dispatched_count,
        COALESCE(j.measured_count,0) AS measured_count,
        COALESCE(j.unknown_count,0) AS unknown_count,
        COALESCE(j.unverified_count,0) AS unverified_count,
        COALESCE(j.measured_cost,0) AS measured_cost
 FROM provider_budget_reservations b
 LEFT JOIN credit_reservations c ON b.id='ai:' || c.request_id
 LEFT JOIN journal j ON b.id='ai:' || j.request_id
)
SELECT COUNT(*) AS budget_reservations,
 COALESCE(SUM(CASE WHEN provider_status='reserved' AND created_at <= ? THEN 1 ELSE 0 END),0) AS stale_budget_holds,
 COALESCE(SUM(CASE WHEN provider_status='reserved' AND wallet_status='reserved'
   AND dispatched_count=0 AND created_at <= ? THEN 1 ELSE 0 END),0) AS stale_pre_dispatch_dual_holds,
 COALESCE(SUM(CASE WHEN provider_status='reserved' AND wallet_status='reserved'
   AND unknown_count>0 AND measured_count=0 THEN 1 ELSE 0 END),0) AS unknown_provider_holds,
 COALESCE(SUM(CASE WHEN provider_status='reserved' AND wallet_status='reserved'
   AND unverified_count>0 AND measured_count=0 THEN 1 ELSE 0 END),0) AS unverified_usage_holds,
 COALESCE(SUM(CASE WHEN provider_status='reserved'
   AND measured_count>0 THEN 1 ELSE 0 END),0) AS measured_pending_provider_settlement,
 COALESCE(SUM(CASE WHEN provider_status='settled' AND wallet_status='reserved'
   THEN 1 ELSE 0 END),0) AS credit_finalization_pending,
 COALESCE(SUM(CASE WHEN provider_status='reserved' AND wallet_status IN ('settled','released')
   THEN 1 ELSE 0 END),0) AS provider_finalization_pending,
 COALESCE(SUM(CASE WHEN provider_status='settled' AND actual_micro_usd>0
   AND measured_count=0 THEN 1 ELSE 0 END),0) AS settled_without_measured_usage,
 COALESCE(SUM(CASE WHEN provider_status='settled' AND actual_micro_usd IS NOT NULL
   AND measured_count>0 AND actual_micro_usd!=measured_cost THEN 1 ELSE 0 END),0) AS settled_measured_cost_mismatch,
 (SELECT COUNT(*) FROM credit_reservations c
   LEFT JOIN provider_budget_reservations b ON b.id='ai:' || c.request_id
   WHERE c.status='reserved' AND b.id IS NULL) AS orphan_wallet_holds,
 COALESCE(SUM(CASE WHEN provider_status='reserved' AND wallet_status IS NULL THEN 1 ELSE 0 END),0) AS orphan_provider_budget_holds,
 (SELECT COUNT(*) FROM journal j
   LEFT JOIN provider_budget_reservations b ON b.id='ai:' || j.request_id
   WHERE j.dispatched_count>0 AND b.id IS NULL) AS orphan_journal_dispatches
FROM paired
`;

export async function inspectStage3HoldTriage(env, {
  nowMs = Date.now(), staleAfterSeconds = 3600
} = {}) {
  if (!env?.DB || typeof env.DB.prepare !== "function")
    throw new TypeError("D1 binding required for Stage 3 triage");
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Number.isSafeInteger(staleAfterSeconds) || staleAfterSeconds < 60)
    throw new TypeError("Valid timestamp and stale window >= 60 seconds required");
  // One aggregate SELECT, therefore one snapshot. No customer IDs, provider
  // payloads, prompts, request IDs, or account balances leave this function.
  const threshold=Math.floor(nowMs/1000)-staleAfterSeconds;
  const row=await env.DB.prepare(SQL).bind(threshold,threshold).first();
  if (!row) throw new Error("Stage 3 reconciliation snapshot unavailable");
  const result={};
  for (const name of COUNTS) {
    // Map snake_case SQL columns to stable camelCase output.
    const key=name.replace(/[A-Z]/g, x=>"_"+x.toLowerCase());
    const n=row[key];
    if (!Number.isSafeInteger(n) || n<0)
      throw new Error("Invalid or incomplete Stage 3 reconciliation count");
    result[name]=n;
  }
  return Object.freeze({
    ...result,
    reviewRequired:COUNTS.some(name=>name!=="budgetReservations" && result[name]>0),
    providerInvoiceVerified:false,
    scope:"inactive_stage3_read_only_triage",
    cutoffUtc:new Date(Math.max(0,threshold)*1000).toISOString(),
    instruction:"Hold uncertain reservations for an independently authorized operator review. Never auto-release or auto-charge."
  });
}
