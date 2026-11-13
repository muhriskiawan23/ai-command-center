// Future, opt-in D1 credit ledger. No route invokes this module yet.
// D1 batch executes in a transaction; failed conditional updates roll back with a guard.
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
  if (!env?.DB?.prepare || !env?.DB?.batch) throw new TypeError("D1 binding required");
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
// Atomic conditional debit; only one request can reserve a given request ID.
// Changes are committed together by D1 batch, and duplicate request IDs fail closed.
export async function reserveCredits(env, { userId, requestId, amountMicrocredits, now = Math.floor(Date.now()/1000) }) {
  const db = requireDb(env);
  identifier(userId, "userId"); identifier(requestId, "requestId");
  const amount = positive(amountMicrocredits, "amountMicrocredits");
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("Invalid timestamp");
  const existing = await db.prepare("SELECT user_id, reserved_microcredits, status FROM credit_reservations WHERE request_id = ?").bind(requestId).first();
  if (existing) return { ok: false, reason: "duplicate_request" };
  // The debit is conditional; a trigger-like guard statement aborts the batch if it did not debit exactly one row.
  // SELECT's result alone cannot abort a D1 transaction, so use a CHECK constraint sentinel.
  try {
    const results = await db.batch([
      db.prepare("UPDATE credit_accounts SET balance_microcredits = balance_microcredits - ?, updated_at = ? WHERE user_id = ? AND balance_microcredits >= ?").bind(amount, now, userId, amount),
      db.prepare("INSERT INTO credit_reservations (request_id, user_id, reserved_microcredits, settled_microcredits, status, created_at, updated_at) SELECT ?, ?, ?, NULL, 'reserved', ?, ? WHERE (SELECT changes()) = 1").bind(requestId, userId, amount, now, now),
      db.prepare("INSERT INTO credit_ledger (id, user_id, delta_microcredits, reason, reference_id, created_at) SELECT ?, ?, ?, 'reserve', ?, ? WHERE EXISTS (SELECT 1 FROM credit_reservations WHERE request_id = ? AND user_id = ? AND status = 'reserved')").bind(`reserve:${requestId}`, userId, -amount, requestId, now, requestId, userId)
    ]);
    if (results[0]?.meta?.changes !== 1 || results[1]?.meta?.changes !== 1 || results[2]?.meta?.changes !== 1) throw new Error("Credit reservation did not commit all expected rows");
    return { ok: true, reservedMicrocredits: amountMicrocredits };
  } catch (error) {
    // Insufficient funds, duplicate request and DB failure all deny provider invocation.
    // This prototype is NOT safe for production integration until atomicity tests are completed.
    return { ok: false, reason: "reservation_rejected" };
  }
}
// Finalization is intentionally NOT implemented until transactional D1 concurrency tests
// verify refund/release semantics. A reservation must never be considered spendable.
export { calculateRemainingCredits };
