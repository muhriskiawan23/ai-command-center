// Sandbox-only, read-only Midtrans status API adapter.
// Never expose server keys to the browser or call this from public routes directly.
import { assertMidtransPaymentMatchesOrder } from "./midtrans-amount.js";
import { classifyMidtransStatus } from "./midtrans-status.js";
const BASE = "https://api.sandbox.midtrans.com";
const ORDER_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_STATUS_BYTES = 32768;
const MAX_STATUS_DEADLINE_MS = 8000;

// Enforce the limit while streaming: a Content-Length check alone does not
// protect against oversized/chunked responses from the payment provider.
async function readBoundedStatusBody(response, signal) {
  const advertised = response.headers?.get?.("Content-Length");
  if (advertised !== undefined && advertised !== null &&
      /^\d+$/.test(advertised) && BigInt(advertised) > BigInt(MAX_STATUS_BYTES)) {
    void response.body?.cancel?.().catch(() => {});
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
  // The outer deadline must reach the active stream reader as well as fetch.
  // A broken ReadableStream.cancel() may never resolve; never await it.
  let rejectInterruption;
  const interrupted = new Promise((_,reject) => { rejectInterruption=reject; });
  const abort = () => {
    void reader.cancel().catch(() => {});
    rejectInterruption(signal?.reason instanceof Error ? signal.reason :
      new Error("Midtrans status body interrupted"));
  };
  signal?.addEventListener("abort",abort,{once:true});
  if(signal?.aborted)abort();
  try {
    for (;;) {
      const { value, done } = await Promise.race([reader.read(),interrupted]);
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > MAX_STATUS_BYTES) throw new Error("Midtrans response too large");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    signal?.removeEventListener("abort",abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export async function readVerifiedSandboxStatus(order, { serverKey, expectedMerchantId, fetchImpl = fetch, signal, requireCurrency = false, timeoutMs = MAX_STATUS_DEADLINE_MS } = {}) {
  if (!order || order.environment !== "sandbox" || !ORDER_ID.test(order.orderId || ""))
    throw new TypeError("Sandbox order with safe ID required");
  if (typeof serverKey !== "string" || !serverKey.startsWith("SB-Mid-server-"))
    throw new TypeError("Sandbox server key required");
  if (typeof expectedMerchantId !== "string" || !expectedMerchantId.trim())
    throw new TypeError("Expected Midtrans sandbox merchant ID required");
  // An upstream fetch or a body stream can stall independently. Do not rely
  // on the caller's fetch implementation respecting an AbortSignal: enforce
  // one bounded, adapter-owned deadline across headers AND the full body.
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_STATUS_DEADLINE_MS)
    throw new TypeError("Bounded Midtrans status timeout required");
  if (signal?.aborted) throw new Error("Midtrans status cancelled");
  const controller = new AbortController();
  let timer, stop;
  const stopped = new Promise((_, reject) => {
    stop = reason => {
      const error = new Error(reason);
      controller.abort(error);
      reject(error);
    };
    timer = setTimeout(() => stop("Midtrans status deadline exceeded"), timeoutMs);
  });
  const abort = () => stop("Midtrans status cancelled");
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let response;
  try {
    const authorization = "Basic " + btoa(serverKey + ":");
    response = await Promise.race([
      fetchImpl(BASE + "/v2/" + encodeURIComponent(order.orderId) + "/status", {
        method: "GET", headers: { Accept: "application/json", Authorization: authorization },
        redirect: "manual", signal: controller.signal
      }),
      stopped
    ]);
    if (!response?.ok) throw new Error("Midtrans sandbox status unavailable");
    const body = await Promise.race([readBoundedStatusBody(response,controller.signal), stopped]);
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
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    // Abort only failed/incomplete requests. A late provider response may not
    // authorize credits after our deadline, regardless of how fetch resolves.
    if (controller.signal.aborted)
      void response?.body?.cancel?.().catch(() => {});
  }
}

export async function checkMidtransSandboxOrder(order, options) {
  const status = await readVerifiedSandboxStatus(order, options);
  return { classification: classifyMidtransStatus(status), providerTransactionId:status.transaction_id,
    merchantId:status.merchant_id, verifiedVia:"sandbox_status_api" };
}
// DB order ownership and atomic fulfillment must still be enforced by the caller.
// This module never credits users.
