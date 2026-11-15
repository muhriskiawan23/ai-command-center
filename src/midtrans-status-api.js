// Sandbox-only, read-only Midtrans status API adapter.
// Never expose server keys to the browser or call this from public routes directly.
import { assertMidtransPaymentMatchesOrder } from "./midtrans-amount.js";
import { classifyMidtransStatus } from "./midtrans-status.js";
const BASE = "https://api.sandbox.midtrans.com";
const ORDER_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_STATUS_BYTES = 32768;

// Enforce the limit while streaming: a Content-Length check alone does not
// protect against oversized/chunked responses from the payment provider.
async function readBoundedStatusBody(response) {
  const advertised = response.headers?.get?.("Content-Length");
  if (advertised !== undefined && advertised !== null &&
      /^\d+$/.test(advertised) && BigInt(advertised) > BigInt(MAX_STATUS_BYTES)) {
    await response.body?.cancel?.().catch(() => {});
    throw new Error("Midtrans response too large");
  }
  const reader = response.body?.getReader?.();
  // Minimal provider mocks in unit tests expose text() rather than a stream.
  // Real fetch Responses always use the bounded streaming branch.
  if (!reader) {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > MAX_STATUS_BYTES)
      throw new Error("Midtrans response too large");
    return body;
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > MAX_STATUS_BYTES) throw new Error("Midtrans response too large");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function readVerifiedSandboxStatus(order, { serverKey, expectedMerchantId, fetchImpl = fetch, signal, requireCurrency = false } = {}) {
  if (!order || order.environment !== "sandbox" || !ORDER_ID.test(order.orderId || ""))
    throw new TypeError("Sandbox order with safe ID required");
  if (typeof serverKey !== "string" || !serverKey.startsWith("SB-Mid-server-"))
    throw new TypeError("Sandbox server key required");
  if (typeof expectedMerchantId !== "string" || !expectedMerchantId.trim())
    throw new TypeError("Expected Midtrans sandbox merchant ID required");
  const authorization = "Basic " + btoa(serverKey + ":");
  const response = await fetchImpl(BASE + "/v2/" + encodeURIComponent(order.orderId) + "/status", {
    method: "GET", headers: { Accept: "application/json", Authorization: authorization },
    redirect: "manual", signal
  });
  if (!response.ok) throw new Error("Midtrans sandbox status unavailable");
  const body = await readBoundedStatusBody(response);
  let status;
  try { status = JSON.parse(body); } catch { throw new Error("Invalid Midtrans JSON"); }
  if (status.status_code !== "200") throw new Error("Midtrans status not confirmed");
  if ((requireCurrency || status.currency !== undefined) && status.currency !== "IDR") throw new Error("Midtrans currency mismatch");
  assertMidtransPaymentMatchesOrder(order,status,"sandbox");
  if (typeof status.transaction_id !== "string" || !status.transaction_id ||
      typeof status.merchant_id !== "string" || !status.merchant_id)
    throw new Error("Midtrans transaction identity missing");
  if (status.merchant_id !== expectedMerchantId) throw new Error("Midtrans merchant mismatch");
  return status;
}

export async function checkMidtransSandboxOrder(order, options) {
  const status = await readVerifiedSandboxStatus(order, options);
  return { classification: classifyMidtransStatus(status), providerTransactionId:status.transaction_id,
    merchantId:status.merchant_id, verifiedVia:"sandbox_status_api" };
}
// DB order ownership and atomic fulfillment must still be enforced by the caller.
// This module never credits users.
