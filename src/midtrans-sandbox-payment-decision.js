// Pure sandbox decision gate. No DB mutation or external payment call.
// Both webhook assessment and independent status API verification are required.
export function decideSandboxPaymentConfirmation(order, webhook, statusApi) {
  if (!order || order.environment !== "sandbox" || !order.orderId ||
      !Number.isSafeInteger(order.amountIdr) || order.amountIdr <= 0 || order.currency !== "IDR")
    throw new TypeError("Valid sandbox order required");
  if (!webhook || !statusApi || webhook.classification?.kind !== "paid_candidate" ||
      webhook.requiresStatusApiConfirmation !== true ||
      statusApi.classification?.kind !== "paid_candidate" ||
      statusApi.verifiedVia !== "sandbox_status_api")
    return {kind:"not_confirmed",reason:"independent_paid_confirmation_required"};
  if (typeof webhook.providerTransactionId !== "string" || !webhook.providerTransactionId ||
      webhook.providerTransactionId !== statusApi.providerTransactionId)
    return {kind:"not_confirmed",reason:"provider_transaction_mismatch"};
  if (typeof statusApi.merchantId !== "string" || !statusApi.merchantId)
    return {kind:"not_confirmed",reason:"merchant_identity_missing"};
  // The status API adapter already validates order ID, amount, currency and
  // configured merchant ID. Never accept arbitrary untrusted objects here:
  // only invoke this function with results of the two trusted adapters.
  return {kind:"verified_paid_candidate",providerTransactionId:statusApi.providerTransactionId,
    merchantId:statusApi.merchantId,environment:"sandbox",orderId:order.orderId};
}
