// Pure sandbox notification verification; no database writes, no credit grants.
// Treat webhook data as untrusted even when its signature is valid.
import { verifyMidtransNotificationSignature } from "./midtrans-signature.js";
import { assertMidtransPaymentMatchesOrder } from "./midtrans-amount.js";
import { classifyMidtransStatus } from "./midtrans-status.js";
export async function assessMidtransSandboxNotification(order, payload, {serverKey,expectedMerchantId}={}) {
  if (!order || order.environment !== "sandbox") throw new TypeError("Sandbox order required");
  if (typeof serverKey !== "string" || !serverKey.startsWith("SB-Mid-server-"))
    throw new TypeError("Sandbox server key required");
  if (typeof expectedMerchantId !== "string" || !expectedMerchantId.trim())
    throw new TypeError("Configured merchant ID required");
  if (!await verifyMidtransNotificationSignature(payload,serverKey))
    throw new Error("Midtrans signature invalid");
  if (payload.currency !== undefined && payload.currency !== "IDR")
    throw new Error("Midtrans notification currency mismatch");
  assertMidtransPaymentMatchesOrder(order,payload,"sandbox");
  if (payload.merchant_id !== expectedMerchantId)
    throw new Error("Midtrans notification merchant mismatch");
  if (typeof payload.transaction_id !== "string" || !payload.transaction_id)
    throw new Error("Midtrans transaction ID missing");
  const classification=classifyMidtransStatus(payload);
  // A valid signature is NOT proof of settlement: paid candidates must be
  // independently checked against the status API before any ledger mutation.
  return {classification,providerTransactionId:payload.transaction_id,
    requiresStatusApiConfirmation:classification.kind==="paid_candidate"};
}
