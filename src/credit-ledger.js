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
// Atomic conditional debit; only one request can reserve a given request ID.
// Changes are committed together by D1 batch, and duplicate request IDs fail closed.
export async function reserveCredits(env, { userId, requestId, amountMicrocredits, now = Math.floor(Date.now()/1000) }) {
  const db = requireDb(env);
  identifier(userId, "userId"); identifier(requestId, "requestId");
  const amount = positive(amountMicrocredits, "amountMicrocredits");
  if (!Number.isSafeInteger(now) || now < 0) throw new TypeError("Invalid timestamp");
  // A single INSERT invokes the database trigger, which atomically checks balance,
  // debits the account and journals the reservation. UNIQUE(request_id) rejects replay.
  try {
    const result = await db.prepare(
      "INSERT INTO credit_reservations (request_id, user_id, reserved_microcredits, settled_microcredits, status, created_at, updated_at) VALUES (?, ?, ?, NULL, 'reserved', ?, ?)"
    ).bind(requestId, userId, amount, now, now).run();
    if (result?.meta?.changes !== 1) throw new Error("Reservation was not inserted");
    return { ok: true, reservedMicrocredits: amountMicrocredits };
  } catch {
    // Fail closed on duplicate, insufficient balance, schema or database failure.
    // Do not invoke any paid provider after a rejected reservation.
    return { ok: false, reason: "reservation_rejected" };
  }
}
// Finalization is intentionally NOT implemented until transactional D1 concurrency tests
// verify refund/release semantics. A reservation must never be considered spendable.
export { calculateRemainingCredits };
