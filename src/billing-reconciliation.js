// Read-only review of the INACTIVE paid-inference prototype.
// Does not grant, debit, release, settle, write logs or expose customer IDs.
// Operational triage only: it is NOT a provider invoice reconciliation.
function validateInputs(env, nowMs, staleAfterSeconds) {
  if (!env?.DB?.prepare || typeof env.DB.prepare !== "function" ||
      typeof env.DB.batch !== "function")
    throw new TypeError("Transactional D1 binding required");
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


const walletJournalMismatchSql = `
SELECT COUNT(*) AS mismatched_wallet_journals
FROM credit_reservations c
LEFT JOIN (
 SELECT user_id,reference_id,
   SUM(CASE WHEN reason='reserve' THEN 1 ELSE 0 END) AS reserve_count,
   SUM(CASE WHEN reason='reserve' THEN delta_microcredits ELSE 0 END) AS reserve_delta,
   SUM(CASE WHEN reason='refund' THEN 1 ELSE 0 END) AS refund_count,
   SUM(CASE WHEN reason='refund' THEN delta_microcredits ELSE 0 END) AS refund_delta
 FROM credit_ledger WHERE reason IN ('reserve','refund')
 GROUP BY user_id,reference_id
) j ON j.user_id=c.user_id AND j.reference_id=c.request_id
WHERE COALESCE(j.reserve_count,0) != 1
  OR COALESCE(j.reserve_delta,0) != -c.reserved_microcredits
  OR (c.status='reserved' AND COALESCE(j.refund_count,0) != 0)
  OR (c.status='released' AND (
    COALESCE(j.refund_count,0) != 1
    OR COALESCE(j.refund_delta,0) != c.reserved_microcredits
  ))
  OR (c.status='settled' AND (
    (c.settled_microcredits = c.reserved_microcredits AND COALESCE(j.refund_count,0) != 0)
    OR (c.settled_microcredits < c.reserved_microcredits AND (
       COALESCE(j.refund_count,0) != 1
       OR COALESCE(j.refund_delta,0) != c.reserved_microcredits - c.settled_microcredits
    ))
  ))
`;
const currentCapExceededSql = `
SELECT COUNT(*) AS daily_counters_over_current_cap
FROM provider_budget_daily d
JOIN provider_budget_limits l ON d.provider=l.provider
WHERE d.reserved_micro_usd > l.daily_cap_micro_usd - d.spent_micro_usd
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
  // D1 executes batch statements sequentially within one transaction.
  // Separate parallel SELECTs could see different snapshots while billing
  // writes happen concurrently and produce false "clean" audit results.
  // Deliberately do not catch missing-table, transaction or D1 errors.
  const results = await db.batch([
    db.prepare(budgetCasesSql).bind(threshold,threshold),
    db.prepare(unpairedCreditSql),
    db.prepare(counterMismatchSql),
    db.prepare(missingCountersSql),
    db.prepare(missingCapsSql),
    db.prepare(walletJournalMismatchSql),
    db.prepare(currentCapExceededSql)
  ]);
  if (!Array.isArray(results) || results.length !== 7)
    throw new Error("Billing reconciliation snapshot unavailable");
  const exactlyOne = (part) => {
    if (part?.success === false || !Array.isArray(part?.results) || part.results.length !== 1)
      throw new Error("Billing reconciliation result incomplete");
    return part.results[0];
  };
  const [pairs, unpaired, counters, missing, caps, journals, ceilings] = results.map(exactlyOne);
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
    counterRowsWithoutCurrentCap: integer(caps,"counter_rows_without_current_cap"),
    mismatchedWalletJournals: integer(journals,"mismatched_wallet_journals"),
    dailyCountersOverCurrentCap: integer(ceilings,"daily_counters_over_current_cap")
  };
  const reviewFields = [
    "staleBudgetHolds","unmatchedBudgetHolds","unpairedReservedCredit",
    "creditFinalizationPending","providerFinalizationPending",
    "paidProviderWithoutCreditDebit","mismatchedDailyCounters",
    "reservationsWithoutDailyCounters","counterRowsWithoutCurrentCap",
    "mismatchedWalletJournals","dailyCountersOverCurrentCap"
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
