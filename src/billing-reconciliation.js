// Read-only review of the INACTIVE paid-inference prototype.
// Does not grant, debit, release, settle, write logs or expose customer IDs.
// Operational triage only: it is NOT a provider invoice reconciliation.
function validateInputs(env, nowMs, staleAfterSeconds) {
  if (!env?.DB?.prepare || typeof env.DB.prepare !== "function")
    throw new TypeError("D1 binding required");
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      !Number.isSafeInteger(staleAfterSeconds) || staleAfterSeconds < 60)
    throw new TypeError("Valid timestamp and minimum 60-second stale window required");
}
const budgetCasesSql = `
SELECT
 COUNT(*) AS budget_orders,
 COALESCE(SUM(CASE WHEN b.status='settled' AND c.status='settled' THEN 1 ELSE 0 END),0) AS both_settled,
 COALESCE(SUM(CASE WHEN b.status='reserved' AND b.created_at <= ? THEN 1 ELSE 0 END),0) AS stale_budget_holds,
 COALESCE(SUM(CASE WHEN b.status='reserved' AND c.status='reserved' AND c.created_at <= ? THEN 1 ELSE 0 END),0) AS stale_dual_holds,
 COALESCE(SUM(CASE WHEN b.status='reserved' AND c.request_id IS NULL THEN 1 ELSE 0 END),0) AS unmatched_budget_holds,
 COALESCE(SUM(CASE WHEN b.status='settled' AND c.status='reserved' THEN 1 ELSE 0 END),0) AS credit_finalization_pending,
 COALESCE(SUM(CASE WHEN b.status='reserved' AND c.status IN ('settled','released') THEN 1 ELSE 0 END),0) AS provider_finalization_pending,
 COALESCE(SUM(CASE WHEN b.status='settled' AND b.actual_micro_usd > 0
      AND (c.request_id IS NULL OR c.status='released') THEN 1 ELSE 0 END),0) AS paid_provider_without_credit_debit
FROM provider_budget_reservations b
LEFT JOIN credit_reservations c ON b.id='ai:' || c.request_id
`;
const unpairedCreditSql = `
SELECT COUNT(*) AS unpaired_reserved_credit
FROM credit_reservations c
LEFT JOIN provider_budget_reservations b ON b.id='ai:' || c.request_id
WHERE c.status='reserved' AND b.id IS NULL
`;
const counterMismatchSql = `
SELECT COUNT(*) AS mismatched_daily_counters FROM (
 SELECT d.day, d.provider
 FROM provider_budget_daily d
 LEFT JOIN provider_budget_reservations r
   ON r.day=d.day AND (r.provider=d.provider OR d.provider='__global__')
 GROUP BY d.day,d.provider
 HAVING d.reserved_micro_usd !=
     COALESCE(SUM(CASE WHEN r.status='reserved' THEN r.reserved_micro_usd ELSE 0 END),0)
   OR d.spent_micro_usd !=
     COALESCE(SUM(CASE WHEN r.status='settled' THEN r.actual_micro_usd ELSE 0 END),0)
)
`;
const missingCountersSql = `
SELECT COUNT(*) AS reservations_without_daily_counters
FROM provider_budget_reservations r
LEFT JOIN provider_budget_daily d ON d.day=r.day AND d.provider=r.provider
LEFT JOIN provider_budget_daily g ON g.day=r.day AND g.provider='__global__'
WHERE d.day IS NULL OR g.day IS NULL
`;
const missingCapsSql = `
SELECT COUNT(*) AS counter_rows_without_current_cap
FROM provider_budget_daily d
LEFT JOIN provider_budget_limits l ON d.provider=l.provider
WHERE l.provider IS NULL
`;

function integer(row, key) {
  const value = row?.[key];
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid reconciliation count");
  return value;
}
export async function inspectDraftBillingReconciliation(env, {
  nowMs = Date.now(), staleAfterSeconds = 3600
} = {}) {
  validateInputs(env, nowMs, staleAfterSeconds);
  const db = env.DB;
  const threshold = Math.floor(nowMs / 1000) - staleAfterSeconds;
  // Deliberately do not catch missing-table or D1 errors: fail closed.
  const [pairs, unpaired, counters, missing, caps] = await Promise.all([
    db.prepare(budgetCasesSql).bind(threshold,threshold).first(),
    db.prepare(unpairedCreditSql).first(),
    db.prepare(counterMismatchSql).first(),
    db.prepare(missingCountersSql).first(),
    db.prepare(missingCapsSql).first()
  ]);
  const report = {
    budgetOrders: integer(pairs,"budget_orders"),
    bothSettled: integer(pairs,"both_settled"),
    staleBudgetHolds: integer(pairs,"stale_budget_holds"),
    staleDualHolds: integer(pairs,"stale_dual_holds"),
    unmatchedBudgetHolds: integer(pairs,"unmatched_budget_holds"),
    unpairedReservedCredit: integer(unpaired,"unpaired_reserved_credit"),
    creditFinalizationPending: integer(pairs,"credit_finalization_pending"),
    providerFinalizationPending: integer(pairs,"provider_finalization_pending"),
    paidProviderWithoutCreditDebit: integer(pairs,"paid_provider_without_credit_debit"),
    mismatchedDailyCounters: integer(counters,"mismatched_daily_counters"),
    reservationsWithoutDailyCounters: integer(missing,"reservations_without_daily_counters"),
    counterRowsWithoutCurrentCap: integer(caps,"counter_rows_without_current_cap")
  };
  const reviewFields = [
    "staleBudgetHolds","unmatchedBudgetHolds","unpairedReservedCredit",
    "creditFinalizationPending","providerFinalizationPending",
    "paidProviderWithoutCreditDebit","mismatchedDailyCounters",
    "reservationsWithoutDailyCounters","counterRowsWithoutCurrentCap"
  ];
  return {
    ...report,
    reviewRequired: reviewFields.some(field => report[field] !== 0),
    cutoffUtc: new Date(Math.max(0,threshold)*1000).toISOString(),
    scope: "prototype_local_ledger_only",
    // No safe inference about upstream invoice, payment revenue or root cause.
    providerInvoiceVerified: false
  };
}
