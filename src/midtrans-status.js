// Pure Midtrans status interpretation. A status is NOT verified by this module.
// Call only after server-side signature, merchant, order and amount checks and,
// where needed, independent Midtrans status API confirmation.
const FINAL_FAILURES = new Set(["deny","cancel","expire","failure"]);
export function classifyMidtransStatus(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new TypeError("Notification object required");
  const { transaction_status: status, fraud_status: fraud } = payload;
  if (typeof status !== "string" || !status) throw new TypeError("Missing transaction status");
  if (fraud !== undefined && fraud !== null && !["accept","challenge","deny"].includes(fraud))
    return { kind:"manual_review", reason:"unknown_fraud_status" };
  if (status === "capture") {
    if (fraud === "accept") return { kind:"paid_candidate" };
    return { kind:"manual_review", reason:"capture_without_fraud_accept" };
  }
  if (status === "settlement") {
    if (fraud === "deny" || fraud === "challenge") return { kind:"manual_review", reason:"settlement_fraud_flag" };
    return { kind:"paid_candidate" };
  }
  if (status === "pending") return { kind:"pending" };
  if (FINAL_FAILURES.has(status)) return { kind:"failed_candidate", providerStatus:status };
  if (status === "refund" || status === "partial_refund" || status === "chargeback")
    return { kind:"manual_review", reason:"reversal_requires_reconciliation" };
  return { kind:"manual_review", reason:"unknown_provider_status" };
}
