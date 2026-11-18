// Development-only D1 provider + cross-provider spend ceiling. No production
// route invokes this module; limits must be provisioned by the operator.
// Amounts are exact micro-USD integers, not request counts or floats.
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function id(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 200)
    throw new TypeError(label + " required");
  return value;
}
function amount(value, allowZero = false) {
  if (typeof value !== "bigint" || value < (allowZero ? 0n : 1n) || value > MAX)
    throw new TypeError("Safe bigint USD budget amount required");
  return Number(value);
}
function dbOf(env) {
  if (!env?.DB?.prepare) throw new TypeError("D1 database required");
  return env.DB;
}
function timestampMs(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Invalid timestamp");
  return value;
}
export function providerBudgetDay(nowMs = Date.now()) {
  return new Date(timestampMs(nowMs)).toISOString().slice(0, 10);
}
export async function reserveProviderSpend(env, {
  id: requestId, provider, model, maximumMicroUsd, nowMs = Date.now()
}) {
  const db = dbOf(env);
  id(requestId, "request ID"); id(provider, "provider"); id(model, "model");
  if (provider === "__global__") throw new TypeError("Reserved provider label");
  const max = amount(maximumMicroUsd);
  const day = providerBudgetDay(nowMs);
  const now = Math.floor(nowMs / 1000);
  try {
    const row = await db.prepare(
      "INSERT INTO provider_budget_reservations (id,day,provider,model,reserved_micro_usd,actual_micro_usd,status,created_at,updated_at) " +
      "VALUES (?,?,?,?,?,NULL,'reserved',?,?) " +
      "RETURNING id,day,provider,reserved_micro_usd,status"
    ).bind(requestId,day,provider,model,max,now,now).first();
    return row?.id === requestId && row?.day === day && row?.provider === provider &&
      row?.reserved_micro_usd === max && row?.status === "reserved"
      ? {ok:true,day,reservedMicroUsd:maximumMicroUsd}
      : {ok:false,reason:"provider_budget_reservation_not_confirmed"};
  } catch {
    return {ok:false,reason:"provider_budget_reservation_rejected"};
  }
}
export async function settleProviderSpend(env, {
  id: requestId, actualMicroUsd, nowMs = Date.now()
}) {
  const db = dbOf(env);
  id(requestId, "request ID");
  const actual = amount(actualMicroUsd, true);
  const now = Math.floor(timestampMs(nowMs) / 1000);
  try {
    const row = await db.prepare(
      "UPDATE provider_budget_reservations SET status='settled',actual_micro_usd=?,updated_at=? " +
      "WHERE id=? AND status='reserved' RETURNING id,status,actual_micro_usd"
    ).bind(actual,now,requestId).first();
    return row?.id === requestId && row?.status === "settled" && row?.actual_micro_usd === actual
      ? {ok:true,spentMicroUsd:actualMicroUsd}
      : {ok:false,reason:"provider_budget_finalization_rejected"};
  } catch {
    return {ok:false,reason:"provider_budget_finalization_rejected"};
  }
}
// Injection adapter for runReservedBillableInference. Server-side code only.
// No cap is created here: missing trusted provider / global cap must fail closed.
export function providerSpendBudget(env) {
  dbOf(env);
  return {
    reserve: (entry) => reserveProviderSpend(env, entry),
    settle: (entry) => settleProviderSpend(env, entry)
  };
}
