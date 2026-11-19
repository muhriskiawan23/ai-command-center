// Isolated operator-only payment proof. No imports from chat or production wallets.
import { json, sha256Hex } from './http.js';

const API = 'https://sandbox.duitku.com/webapi/api/merchant/';
const CALLBACK = '/api/duitku/callback';
const ORDER_ID = /^BORTEST-[a-f0-9-]{36}$/;
const REFERENCE = /^[A-Za-z0-9_-]{1,255}$/;
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
function fail(status, code) { throw new HttpError(status, code); }
function ready(env) {
  return env.PAYMENT_SANDBOX_ENABLED === 'true'
    && /^DS\d+$/.test(env.DUITKU_SANDBOX_MERCHANT_CODE || '')
    && typeof env.DUITKU_SANDBOX_API_KEY === 'string' && env.DUITKU_SANDBOX_API_KEY.length >= 10
    && typeof env.DUITKU_SANDBOX_OPERATOR_TOKEN === 'string' && env.DUITKU_SANDBOX_OPERATOR_TOKEN.length >= 32
    && !!env.SANDBOX_DB;
}
function origin(env) {
  const value = new URL(env.SANDBOX_PUBLIC_ORIGIN);
  if (value.protocol !== 'https:' || value.username || value.password || value.port || value.pathname !== '/' || value.search || value.hash) fail(503, 'invalid_origin');
  return value.origin;
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export async function duitkuSignature(key, value) {
  const secret = await crypto.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = await crypto.subtle.sign('HMAC', secret, encoder.encode(value));
  return Array.from(new Uint8Array(signed), x => x.toString(16).padStart(2, '0')).join('');
}
async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > 8192) fail(413, 'body_too_large');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'empty_body');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 8192) { await reader.cancel(); fail(413, 'body_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}
async function provider(env, endpoint, payload) {
  let response;
  try {
    response = await (env.DUITKU_FETCHER || fetch)(API + endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15000), redirect: 'error'
    });
    if (!response.ok) fail(502, 'duitku_unavailable');
    const raw = await readBody(response);
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail(502, 'invalid_duitku_response');
    return data;
  } catch (error) {
    if (error instanceof HttpError && error.status === 502) throw error;
    fail(502, 'duitku_unavailable');
  }
}
async function getOrder(env, id) {
  return env.SANDBOX_DB.prepare('SELECT * FROM duitku_sandbox_orders WHERE id=?').bind(id).first();
}
function publicOrder(order) {
  return { sandbox: true, orderId: order.id, status: order.status, amountIdr: order.amount_idr,
    testCredits: order.test_credits, reference: order.reference, paymentUrl: order.payment_url,
    realCreditsGranted: false };
}
function safePaymentUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'sandbox.duitku.com' && !url.port && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
async function checkout(request, env) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, 'json_required');
  let input;
  try { input = JSON.parse(await readBody(request)); } catch (error) { if (error instanceof HttpError) throw error; fail(400, 'invalid_json'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'invalid_request');
  if (Object.keys(input).some(key => !['requestId','email','customerName'].includes(key))) fail(400, 'unsupported_field');
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(input.requestId || '')) fail(400, 'invalid_request_id');
  if (typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) fail(400, 'invalid_email');
  if (typeof input.customerName !== 'string' || !/^[A-Za-z0-9 .'-]{1,20}$/.test(input.customerName)) fail(400, 'invalid_customer_name');
  const id = 'BORTEST-' + input.requestId;
  const requestHash = await sha256Hex(JSON.stringify([input.email, input.customerName]));
  const existing = await getOrder(env, id);
  if (existing) {
    if (existing.request_hash !== requestHash) fail(409, 'request_id_conflict');
    return json(publicOrder(existing), existing.payment_url || existing.status === 'paid' ? 200 : 409);
  }
  const now = Date.now();
  const inserted = await env.SANDBOX_DB.prepare(`INSERT OR IGNORE INTO duitku_sandbox_orders
    (id,request_hash,merchant_code,amount_idr,test_credits,payment_method,status,created_at,updated_at)
    SELECT ?,?,?,10000,100,'BT','creating',?,?
    WHERE (SELECT COUNT(*) FROM duitku_sandbox_orders WHERE created_at>=?) < 10`).bind(
      id, requestHash, env.DUITKU_SANDBOX_MERCHANT_CODE, now, now, now - 86400000).run();
  if (!inserted.meta?.changes) {
    const raced = await getOrder(env, id);
    if (raced) {
      if (raced.request_hash !== requestHash) fail(409, 'request_id_conflict');
      return json(publicOrder(raced), 409);
    }
    fail(429, 'sandbox_daily_limit');
  }
  // Never retry invoice creation after a timeout: the provider may have created it.
  // A callback or explicit reconciliation can recover an ambiguous response.
  try {
    const merchantCode = env.DUITKU_SANDBOX_MERCHANT_CODE;
    const result = await provider(env, 'v2/inquiry', {
      merchantCode, merchantOrderId: id, paymentAmount: 10000, paymentMethod: 'BT',
      productDetails: 'BOR AI SANDBOX - 100 test credits (no real balance)',
      email: input.email, customerVaName: input.customerName,
      itemDetails: [{ name: 'BOR AI sandbox test', price: 10000, quantity: 1 }],
      callbackUrl: origin(env) + CALLBACK, returnUrl: origin(env) + '/return', expiryPeriod: 60,
      signature: await duitkuSignature(env.DUITKU_SANDBOX_API_KEY, merchantCode + id + '10000')
    });
    const paymentUrl = safePaymentUrl(result.paymentUrl);
    if (result.statusCode !== '00' || result.merchantCode !== merchantCode || String(result.amount) !== '10000' || !REFERENCE.test(result.reference || '') || !paymentUrl) fail(502, 'invalid_invoice');
    await env.SANDBOX_DB.prepare(`UPDATE duitku_sandbox_orders SET reference=?,payment_url=?,
      status=CASE WHEN status IN ('creating','provider_unknown') THEN 'pending' ELSE status END,updated_at=?
      WHERE id=? AND (reference IS NULL OR reference=?)`).bind(result.reference, paymentUrl, Date.now(), id, result.reference).run();
    const saved = await getOrder(env, id);
    if (saved.reference !== result.reference) fail(502, 'reference_conflict');
    return json(publicOrder(saved), 201);
  } catch (error) {
    await env.SANDBOX_DB.prepare("UPDATE duitku_sandbox_orders SET status='provider_unknown',updated_at=? WHERE id=? AND status='creating'").bind(Date.now(), id).run();
    if (error instanceof HttpError) throw error;
    fail(502, 'checkout_unavailable');
  }
}
async function reconcile(env, order, callbackReference) {
  if (order.merchant_code !== env.DUITKU_SANDBOX_MERCHANT_CODE) fail(409, 'merchant_mismatch');
  if (order.status === 'paid') return order;
  const now = Date.now();
  const claimed = await env.SANDBOX_DB.prepare('UPDATE duitku_sandbox_orders SET verify_after=? WHERE id=? AND verify_after<=? AND status<>\'paid\'').bind(now + 30000, order.id, now).run();
  if (!claimed.meta?.changes) fail(503, 'verification_retry_later');
  const merchantCode = env.DUITKU_SANDBOX_MERCHANT_CODE;
  const status = await provider(env, 'transactionStatus', {
    merchantCode, merchantOrderId: order.id,
    signature: await duitkuSignature(env.DUITKU_SANDBOX_API_KEY, merchantCode + order.id)
  });
  if (status.merchantOrderId !== order.id || String(status.amount) !== String(order.amount_idr)
      || !REFERENCE.test(status.reference || '') || (order.reference && status.reference !== order.reference)
      || (callbackReference && status.reference !== callbackReference)
      || !['00','01','02'].includes(status.statusCode)) fail(502, 'status_mismatch');
  const next = status.statusCode === '00' ? 'paid' : status.statusCode === '02' ? 'failed' : 'pending';
  // D1 executes this update plus the unique test-credit ledger trigger atomically.
  await env.SANDBOX_DB.prepare(`UPDATE duitku_sandbox_orders SET reference=?,status=?,updated_at=?
    WHERE id=? AND status<>'paid' AND (reference IS NULL OR reference=?)`).bind(status.reference, next, Date.now(), order.id, status.reference).run();
  const saved = await getOrder(env, order.id);
  if (saved.reference !== status.reference) fail(502, 'reference_conflict');
  return saved;
}
async function callback(request, env) {
  if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) fail(415, 'form_required');
  const form = new URLSearchParams(await readBody(request));
  for (const key of ['merchantCode','amount','merchantOrderId','signature','reference','resultCode']) if (form.getAll(key).length !== 1) fail(400, 'invalid_callback');
  const merchantCode = form.get('merchantCode'), amount = form.get('amount'), id = form.get('merchantOrderId'), reference = form.get('reference');
  if (merchantCode !== env.DUITKU_SANDBOX_MERCHANT_CODE || !ORDER_ID.test(id || '') || amount !== '10000'
      || !REFERENCE.test(reference || '') || !['00','01'].includes(form.get('resultCode'))) fail(400, 'invalid_callback');
  const signature = form.get('signature');
  if (!/^[a-f0-9]{64}$/.test(signature || '') || !equal(signature, await duitkuSignature(env.DUITKU_SANDBOX_API_KEY, merchantCode + amount + id))) fail(403, 'invalid_signature');
  const order = await getOrder(env, id);
  if (!order) fail(404, 'order_not_found');
  if (order.amount_idr !== Number(amount) || (order.reference && order.reference !== reference)) fail(409, 'order_mismatch');
  // resultCode and browser return parameters never authorize a grant.
  const saved = await reconcile(env, order, reference);
  if (saved.status === 'pending') fail(503, 'payment_still_pending');
  return json({ received: true, sandbox: true });
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, sandbox: true, configured: ready(env), realPaymentsEnabled: false });
      if (url.pathname === CALLBACK && request.method !== 'POST') return json({ error: 'post_required', sandbox: true }, 405, { Allow: 'POST' });
      if (url.pathname === '/return' && request.method === 'GET') return json({ sandbox: true, message: 'Kembali dari checkout Sandbox. Ini bukan bukti pembayaran; cek status order melalui endpoint operator.', realCreditsGranted: false });
      if (url.pathname !== CALLBACK && !url.pathname.startsWith('/api/sandbox/')) fail(404, 'not_found');
      if (!ready(env)) fail(503, 'sandbox_not_configured');
      origin(env);
      if (url.pathname === CALLBACK) return await callback(request, env);
      const authorization = request.headers.get('Authorization') || '';
      if (!equal(authorization, 'Bearer ' + env.DUITKU_SANDBOX_OPERATOR_TOKEN)) fail(401, 'unauthorized');
      if (url.pathname === '/api/sandbox/checkout' && request.method === 'POST') return await checkout(request, env);
      const match = /^\/api\/sandbox\/orders\/(BORTEST-[a-f0-9-]{36})(\/reconcile)?$/.exec(url.pathname);
      if (match) {
        if (request.method !== (match[2] ? 'POST' : 'GET')) fail(405, 'method_not_allowed');
        const order = await getOrder(env, match[1]);
        if (!order) fail(404, 'order_not_found');
        return json(publicOrder(match[2] ? await reconcile(env, order) : order));
      }
      fail(404, 'not_found');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      return json({ error: error instanceof HttpError ? error.code : 'sandbox_unavailable', sandbox: true }, status,
        status === 503 ? { 'Retry-After': '30' } : {});
    }
  }
};
