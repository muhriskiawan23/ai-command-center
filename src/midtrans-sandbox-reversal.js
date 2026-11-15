import { assertMidtransPaymentMatchesOrder, parseMidtransGrossAmountIdr } from "./midtrans-amount.js";
import { readVerifiedSandboxStatus } from "./midtrans-status-api.js";

const REVERSALS = new Set(["refund", "partial_refund", "chargeback", "partial_chargeback"]);

export function isSandboxReversalStatus(status) {
  return REVERSALS.has(status);
}

function hasConfirmedFullRefund(status, amountIdr) {
  if (status.transaction_status !== "refund" || !Array.isArray(status.refunds) || status.refunds.length === 0)
    return false;
  try {
    if (parseMidtransGrossAmountIdr(status.refund_amount) !== amountIdr) return false;
    const seen = new Set();
    let confirmed = 0n;
    for (const refund of status.refunds) {
      const id = refund?.refund_chargeback_id;
      if (!Number.isSafeInteger(id) || id <= 0 || seen.has(id) ||
          typeof refund.bank_confirmed_at !== "string" || !refund.bank_confirmed_at.trim()) return false;
      seen.add(id);
      confirmed += BigInt(parseMidtransGrossAmountIdr(refund.refund_amount));
    }
    return confirmed === BigInt(amountIdr);
  } catch {
    return false;
  }
}

// The caller must authenticate the notification before invoking this function.
export async function handleSandboxReversal({ db, payload, serverKey, expectedMerchantId, fetchImpl }) {
  const orderId = payload.order_id;
  const row = await db.prepare(
    "SELECT order_id,environment,currency,amount_idr,provider_transaction_id,state FROM payment_orders WHERE order_id=?"
  ).bind(orderId).first();
  if (row?.environment !== "sandbox" || !["fulfilled", "refunded", "disputed"].includes(row.state))
    return "not_confirmed";

  const order = { orderId: row.order_id, environment: row.environment, currency: row.currency, amountIdr: row.amount_idr };
  assertMidtransPaymentMatchesOrder(order, payload, "sandbox");
  if (typeof payload.transaction_id !== "string" || payload.transaction_id !== row.provider_transaction_id ||
      (payload.currency !== undefined && payload.currency !== order.currency)) return "not_confirmed";
  const status = await readVerifiedSandboxStatus(order, { serverKey, expectedMerchantId, fetchImpl, requireCurrency: true });
  if (status.transaction_id !== row.provider_transaction_id) return "not_confirmed";
  if (!isSandboxReversalStatus(status.transaction_status)) return "retry";

  const reversed = await db.prepare(
    "SELECT outcome FROM sandbox_payment_reversals WHERE order_id=?"
  ).bind(orderId).first();
  if (reversed) return reversed.outcome === "reversed" ? "unchanged" : reversed.outcome;

  const priorChargeback = await db.prepare(
    "SELECT 1 FROM sandbox_payment_reversal_reviews WHERE order_id=? AND provider_status IN ('chargeback','partial_chargeback') LIMIT 1"
  ).bind(orderId).first();
  if (payload.transaction_status !== "refund" || priorChargeback ||
      !hasConfirmedFullRefund(status, order.amountIdr)) {
    await db.prepare(
      "INSERT INTO sandbox_payment_reversal_reviews (order_id,provider_status,created_at) VALUES (?,?,?) ON CONFLICT DO NOTHING"
    ).bind(orderId, status.transaction_status, Date.now()).run();
    return "review_required";
  }

  // The trigger atomically reverses the original grant if balance permits.
  const result = await db.batch([
    db.prepare(
      "INSERT INTO sandbox_payment_reversals (order_id,provider_transaction_id,kind,amount_idr,created_at) SELECT order_id,provider_transaction_id,'refund',amount_idr,? FROM payment_orders p WHERE order_id=? AND environment='sandbox' AND state='fulfilled' AND NOT EXISTS (SELECT 1 FROM sandbox_payment_reversal_reviews r WHERE r.order_id=p.order_id AND r.provider_status IN ('chargeback','partial_chargeback')) ON CONFLICT(order_id) DO NOTHING RETURNING order_id"
    ).bind(Date.now(), orderId),
    db.prepare("SELECT outcome FROM sandbox_payment_reversals WHERE order_id=?").bind(orderId)
  ]);
  const outcome = result[1]?.results?.[0]?.outcome;
  if (outcome === "review_required") return outcome;
  if (outcome === "reversed") return result[0]?.results?.length === 1 ? outcome : "unchanged";
  throw new Error("Sandbox reversal outcome missing");
}
