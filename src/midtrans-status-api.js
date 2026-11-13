// Sandbox-only, read-only Midtrans status API adapter.
// Never expose server keys to the browser or call this from public routes directly.
import { assertMidtransPaymentMatchesOrder } from "./midtrans-amount.js";
import { classifyMidtransStatus } from "./midtrans-status.js";
const BASE = "https://api.sandbox.midtrans.com";
const ORDER_ID = /^[A-Za-z0-9_-]{1,100}$/;
export async function checkMidtransSandboxOrder(order, { serverKey, fetchImpl = fetch, signal } = {}) {
  if (!order || order.environment !== "sandbox" || !ORDER_ID.test(order.orderId || ""))
    throw new TypeError("Sandbox order with safe ID required");
  if (typeof serverKey !== "string" || !serverKey.startsWith("SB-Mid-server-"))
    throw new TypeError("Sandbox server key required");
  const authorization = "Basic " + btoa(serverKey + ":");
  const response = await fetchImpl(BASE + "/v2/" + encodeURIComponent(order.orderId) + "/status", {
    method: "GET", headers: { Accept: "application/json", Authorization: authorization },
    redirect: "error", signal
  });
  if (!response.ok) throw new Error("Midtrans sandbox status unavailable");
  const body = await response.text();
  if (body.length > 32768) throw new Error("Midtrans response too large");
  let status;
  try { status = JSON.parse(body); } catch { throw new Error("Invalid Midtrans JSON"); }
  if (status.status_code !== "200") throw new Error("Midtrans status not confirmed");
  assertMidtransPaymentMatchesOrder(order,status,"sandbox");
  if (typeof status.transaction_id !== "string" || !status.transaction_id ||
      typeof status.merchant_id !== "string" || !status.merchant_id)
    throw new Error("Midtrans transaction identity missing");
  return { classification: classifyMidtransStatus(status), providerTransactionId:status.transaction_id,
    merchantId:status.merchant_id, verifiedVia:"sandbox_status_api" };
}
// Merchant ID comparison and DB order ownership checks must be enforced by the
// caller before any state transition. This module never credits users.
