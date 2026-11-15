import { fulfillVerifiedSandboxPayment, reconcileSandboxPayment } from "./midtrans-sandbox-fulfillment.js";
import { verifyMidtransNotificationSignature } from "./midtrans-signature.js";
import { classifyMidtransStatus } from "./midtrans-status.js";

const SNAP_ORIGIN = "https://app.sandbox.midtrans.com";
const SNAP_CHECKOUT_PATH = /^\/snap\/(?:v2\/vtweb|v[34]\/redirection)\/[a-f0-9-]{36}$/i;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ORDER_PREFIX = "bor-sbx-";
const FIXTURE = { user: "midtrans-sandbox-test", sku: "sandbox-credit-test", amount: 10000, credits: 25 };

function json(status, body) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function parseJson(message) {
  const reader = message.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(text + decoder.decode());
      bytes += value.byteLength;
      if (bytes > 16384) throw new Error("Body exceeds limit");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function checkout(request, env, providerFetch) {
  const key = request.headers.get("Idempotency-Key");
  if (!UUID.test(key ?? "")) return json(400, { error: "Provide a UUID v4 Idempotency-Key" });

  const orderId = ORDER_PREFIX + key;
  const now = Date.now();
  const db = env.SANDBOX_DB;
  await db.prepare(
    "INSERT INTO payment_orders (order_id,user_id,sku,environment,currency,amount_idr,grant_microcredits,state,created_at,updated_at) VALUES (?,?,?,'sandbox','IDR',?,?,'created',?,?) ON CONFLICT(order_id) DO NOTHING"
  ).bind(orderId, FIXTURE.user, FIXTURE.sku, FIXTURE.amount, FIXTURE.credits, now, now).run();
  const order = await db.prepare(
    "SELECT p.state,p.amount_idr,r.redirect_url FROM payment_orders p LEFT JOIN sandbox_checkout_receipts r ON r.order_id=p.order_id WHERE p.order_id=? AND p.environment='sandbox' AND p.user_id=? AND p.sku=?"
  ).bind(orderId, FIXTURE.user, FIXTURE.sku).first();
  if (order?.state !== "created") return json(409, { orderId, error: "Order no longer open for checkout" });
  const receiptResponse = (status, redirectUrl) => json(status, { orderId, amountIdr: order.amount_idr, redirectUrl });
  if (order.redirect_url) return receiptResponse(200, order.redirect_url);

  const attemptId = crypto.randomUUID();
  const acquired = await db.prepare(
    "INSERT INTO sandbox_checkout_receipts (order_id,attempt_id,retry_at) SELECT order_id,?,? FROM payment_orders WHERE order_id=? AND environment='sandbox' AND state='created' ON CONFLICT(order_id) DO UPDATE SET attempt_id=excluded.attempt_id,retry_at=excluded.retry_at WHERE sandbox_checkout_receipts.redirect_url IS NULL AND sandbox_checkout_receipts.retry_at<=? RETURNING attempt_id"
  ).bind(attemptId, now + 30_000, orderId, now).first();
  if (!acquired) return json(409, { orderId, error: "Checkout attempt in progress", retryWithSameKey: true });

  const failure = (diagnostic) => json(502, { orderId, error: "Sandbox checkout unavailable", diagnostic });
  const signal = AbortSignal.timeout(8000);
  let response;
  try {
    response = await providerFetch(SNAP_ORIGIN + "/snap/v1/transactions", {
      method: "POST",
      redirect: "manual",
      signal,
      headers: {
        Authorization: "Basic " + btoa(env.MIDTRANS_SANDBOX_SERVER_KEY + ":"),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ transaction_details: { order_id: orderId, gross_amount: order.amount_idr } }),
    });
  } catch {
    return failure(signal.aborted ? "snap_timeout" : "snap_connection_failed");
  }
  // Report the HTTP status to the authenticated operator without returning
  // Midtrans response bodies, request headers, or credentials.
  if (response.status !== 201) return failure("snap_http_" + response.status);
  let receipt;
  try {
    receipt = await parseJson(response);
  } catch {
    return failure(signal.aborted ? "snap_timeout" : "snap_invalid_json");
  }
  const destination = typeof receipt?.redirect_url === "string" && URL.canParse(receipt.redirect_url)
    ? new URL(receipt.redirect_url) : null;
  if (!destination || destination.origin !== SNAP_ORIGIN || destination.username || destination.password)
    return failure("snap_invalid_redirect_origin");
  if (!SNAP_CHECKOUT_PATH.test(destination.pathname)) return failure("snap_invalid_redirect_path");
  const saved = await db.prepare(
    "UPDATE sandbox_checkout_receipts SET redirect_url=? WHERE order_id=? AND attempt_id=? AND EXISTS (SELECT 1 FROM payment_orders WHERE order_id=? AND environment='sandbox' AND state='created') RETURNING order_id"
  ).bind(destination.href, orderId, attemptId, orderId).first();
  if (!saved) return json(409, { orderId, error: "Checkout attempt superseded", retryWithSameKey: true });
  return receiptResponse(201, destination.href);
}

function isSandboxOrderId(value) {
  return typeof value === "string" && value.startsWith(ORDER_PREFIX) &&
    UUID.test(value.slice(ORDER_PREFIX.length));
}

async function reconcile(request, env, providerFetch) {
  let input;
  try {
    input = await parseJson(request);
  } catch {
    return json(400, { error: "Invalid JSON" });
  }
  if (!isSandboxOrderId(input?.orderId)) return json(400, { error: "Invalid sandbox order" });
  const result = await reconcileSandboxPayment({
    db: env.SANDBOX_DB,
    orderId: input.orderId,
    serverKey: env.MIDTRANS_SANDBOX_SERVER_KEY,
    expectedMerchantId: env.MIDTRANS_SANDBOX_MERCHANT_ID,
    fetchImpl: (url, options) => providerFetch(url, { ...options, signal: AbortSignal.timeout(8000) }),
  });
  return json(200, { orderId: input.orderId, outcome: result.kind, reason: result.reason });
}

async function webhook(request, env, providerFetch) {
  const signatureKey = env.MIDTRANS_SANDBOX_SIGNATURE_SECRET_KEY;
  if (!signatureKey?.trim()) return json(503, { error: "Sandbox webhook signing key not configured" });
  let payload;
  try {
    payload = await parseJson(request);
  } catch {
    return json(400, { error: "Invalid JSON notification" });
  }
  if (!isSandboxOrderId(payload?.order_id) ||
      typeof payload.status_code !== "string" || !payload.status_code ||
      typeof payload.gross_amount !== "string" || !payload.gross_amount)
    return json(400, { error: "Invalid sandbox notification" });
  const serverKey = env.MIDTRANS_SANDBOX_SERVER_KEY;
  if (payload.merchant_id !== env.MIDTRANS_SANDBOX_MERCHANT_ID ||
      !await verifyMidtransNotificationSignature(payload, signatureKey))
    return json(401, { error: "Invalid notification signature" });
  if (classifyMidtransStatus(payload).kind !== "paid_candidate")
    return json(200, { outcome: "not_confirmed" });

  const result = await fulfillVerifiedSandboxPayment({
    db: env.SANDBOX_DB,
    orderId: payload.order_id,
    payload,
    serverKey,
    signatureKey,
    expectedMerchantId: env.MIDTRANS_SANDBOX_MERCHANT_ID,
    fetchImpl: (url, options) => providerFetch(url, { ...options, signal: AbortSignal.timeout(8000) }),
  });
  if (result.kind === "retry") return json(503, { outcome: result.kind, reason: result.reason });
  return json(200, { outcome: result.kind });
}

// Separate Worker entry point for a disposable sandbox account and database.
export async function handleSandboxPayment(request, env, providerFetch = fetch) {
  if (env.PAYMENT_SANDBOX_ENABLED !== "true" || !env.SANDBOX_DB ||
      !env.MIDTRANS_SANDBOX_SERVER_KEY?.startsWith("SB-Mid-server-") ||
      !env.MIDTRANS_SANDBOX_MERCHANT_ID?.trim() || !(env.SANDBOX_OPERATOR_TOKEN?.length >= 32))
    return json(404, { error: "Sandbox unavailable" });

  const path = new URL(request.url).pathname;
  if (!["/checkout", "/webhook", "/reconcile"].includes(path)) return json(404, { error: "Not found" });
  if (request.method !== "POST") return json(405, { error: "Method not allowed" });
  if (path !== "/webhook" && request.headers.get("Authorization") !== "Bearer " + env.SANDBOX_OPERATOR_TOKEN)
    return json(401, { error: "Unauthorized" });
  try {
    if (path === "/checkout") return await checkout(request, env, providerFetch);
    if (path === "/reconcile") return await reconcile(request, env, providerFetch);
    return await webhook(request, env, providerFetch);
  } catch {
    return json(503, { error: "Sandbox temporarily unavailable" });
  }
}

export default { fetch: (request, env) => handleSandboxPayment(request, env) };
