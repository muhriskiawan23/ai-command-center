// Future, opt-in D1 credit ledger. No route invokes this module yet.
// SQLite trigger enforces one-statement atomic reservation; integration tests still required.
import { calculateRemainingCredits } from "./credit-metering.js";
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function positive(value, label) {
  if (typeof value !== "bigint" || value <= 0n || value > MAX) throw new TypeError(`${label} must be a positive safe bigint`);
  return Number(value);
}
function identifier(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) throw new TypeError(`${label} must be a non-empty identifier`);
  return value;
}
function requireDb(env) {
  if (!env?.DB?.prepare) throw new TypeError("D1 binding required");
  return env.DB;
}
export async function readCreditBalance(env, userId) {
  const db = requireDb(env);
  identifier(userId, "userId");
  const row = await db.prepare("SELECT balance_microcredits FROM credit_accounts WHERE user_id = ?").bind(userId).first();
  if (!row) return 0n;
  const balance = row.balance_microcredits;
  if (!Number.isSafeInteger(balance) || balance < 0) throw new Error("Invalid credit balance");
  return BigInt(balance);
}
// A unique request ID and database trigger protect the reservation debit.
export async function reserveCredits(env, { userId, requestId, amountMicrocredits, now = Math.floor(Date.now()/1000) }) {
  const db = requireDb(env);
  identifier(userId, "userId"); identifier(requestId, "requestId");
  const amount = positive(amountMicrocredits, "amountMicrocredits");
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("Invalid timestamp");
  // A single INSERT invokes the database trigger, which atomically checks balance,
  // debits the account and journals the reservation. UNIQUE(request_id) rejects replay.
  try {
    // INSERT ... RETURNING reports the affected row, regardless of whether D1
    // counts trigger side effects in meta.changes. The statement and debit
    // trigger commit atomically or roll back together.
    const inserted = await db.prepare(
      "INSERT INTO credit_reservations (request_id, user_id, reserved_microcredits, settled_microcredits, status, created_at, updated_at) VALUES (?, ?, ?, NULL, 'reserved', ?, ?) RETURNING request_id, user_id, reserved_microcredits, status"
    ).bind(requestId, userId, amount, now, now).first();
    if (inserted?.request_id !== requestId || inserted?.user_id !== userId ||
        inserted?.reserved_microcredits !== amount || inserted?.status !== "reserved")
      throw new Error("Reservation result not confirmed");
    return { ok: true, reservedMicrocredits: amountMicrocredits };
  } catch {
    // Fail closed on duplicate, insufficient balance, schema or database failure.
    // Do not invoke any paid provider after a rejected reservation.
    return { ok: false, reason: "reservation_rejected" };
  }
}
// A single conditional UPDATE invokes an atomic database refund trigger.
// A second finalize attempt changes no rows; it must never refund twice.
export async function finalizeCredits(env, { userId, requestId, settledMicrocredits = null, now = Math.floor(Date.now()/1000) }) {
  const db = requireDb(env);
  identifier(userId, "userId"); identifier(requestId, "requestId");
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("Invalid timestamp");
  const settled = settledMicrocredits === null ? null : positiveOrZero(settledMicrocredits);
  const status = settled === null ? "released" : "settled";
  try {
    // The AFTER UPDATE refund trigger shares the same statement transaction.
    // RETURNING avoids mistaking trigger-inclusive change counts for the
    // number of reservation rows finalized.
    const finalized = await db.prepare(
      "UPDATE credit_reservations SET status = ?, settled_microcredits = ?, updated_at = ? WHERE request_id = ? AND user_id = ? AND status = 'reserved' RETURNING request_id, user_id, status, settled_microcredits"
    ).bind(status, settled, now, requestId, userId).first();
    return finalized?.request_id === requestId && finalized?.user_id === userId &&
      finalized?.status === status && finalized?.settled_microcredits === settled
      ? { ok: true, status } : { ok: false, reason: "finalization_rejected" };
  } catch {
    return { ok: false, reason: "finalization_rejected" };
  }
}
function positiveOrZero(value) {
  if (typeof value !== "bigint" || value < 0n || value > MAX) throw new TypeError("settledMicrocredits must be a non-negative safe bigint");
  return Number(value);
}
// Do not call from production routes until D1 integration/concurrency tests pass.
export { calculateRemainingCredits };
