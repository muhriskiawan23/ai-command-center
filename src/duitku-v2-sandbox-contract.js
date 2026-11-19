// Duitku V2 SANDBOX transport adapter. Only the opt-in isolated billing staging Worker may use it.
// This transport can call the Duitku SANDBOX only when an explicit fetcher is
// supplied by a trusted server context. It does not settle or grant credits.
import { duitkuSignature } from './duitku-sandbox-worker.js';

const ORIGIN = 'https://sandbox.duitku.com';
const API = ORIGIN + '/webapi/api/merchant/';
const ID = /^[A-Za-z0-9:_-]{10,90}$/;
const REF = /^[A-Za-z0-9_-]{1,255}$/;
const NUMBER = /^[1-9][0-9]{0,11}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PROVIDER_BYTES = 16_384;

function configString(value, name, regex) {
  if (typeof value !== 'string' || !regex.test(value)) throw new TypeError('invalid_' + name);
  return value;
}
function positiveIdr(value) {
  const s = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  return configString(s, 'idr_amount', NUMBER);
}
function publicOrigin(urlValue) {
  const u = new URL(urlValue);
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash ||
      u.pathname !== '/' || !u.hostname || u.hostname === 'localhost') throw new TypeError('invalid_public_origin');
  return u.origin;
}
export function validSandboxPaymentUrl(candidate) {
  try {
    const url = new URL(candidate);
    // No user controlled merchant redirect, unsafe URL scheme, ports or credentials.
    return url.protocol === 'https:' && url.hostname === 'sandbox.duitku.com' &&
      !url.username && !url.password && !url.port && !url.hash && url.pathname.startsWith('/');
  } catch {
    return false;
  }
}
async function readResponseBounded(response) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_BYTES) throw new Error('duitku_sandbox_unavailable');
  if (!response.body) throw new Error('duitku_sandbox_unavailable');
  const reader = response.body.getReader();
  const chunks = []; let used = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    used += value.byteLength;
    if (used > MAX_PROVIDER_BYTES) {
      await reader.cancel();
      throw new Error('duitku_sandbox_unavailable');
    }
    chunks.push(value);
  }
  const result = new Uint8Array(used); let pos = 0;
  for (const chunk of chunks) { result.set(chunk, pos); pos += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result)); }
  catch { throw new Error('duitku_sandbox_unavailable'); }
}
function requireResponse(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
    throw new Error('duitku_sandbox_unavailable');
  return candidate;
}
// The caller supplies an *explicit* fetch function: test suite mock or an
// independently reviewed Sandbox Worker binding. No network occurs at import.
export function createDuitkuV2SandboxAdapter({
  merchantCode, apiKey, publicBaseUrl, fetcher, timeoutMs = 15000
}) {
  configString(merchantCode, 'merchant', /^DS[0-9]+$/);
  if (typeof apiKey !== 'string' || apiKey.length < 10) throw new TypeError('invalid_sandbox_secret');
  const origin = publicOrigin(publicBaseUrl);
  if (typeof fetcher !== 'function') throw new Error('explicit_sandbox_fetcher_required');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 15000)
    throw new TypeError('invalid_timeout');
  async function call(endpoint, body) {
    let response;
    try {
      response = await fetcher(API + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        redirect: 'manual', // Cloudflare Workers does not support redirect:error
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response?.ok || response.status !== 200) throw new Error('unavailable');
      return requireResponse(await readResponseBounded(response));
    } catch {
      // Never expose provider bodies, signed payloads, keys or URLs in errors.
      throw new Error('duitku_sandbox_unavailable');
    }
  }
  return Object.freeze({
    sandboxV2TransportOnly: true,
    merchantCode,
    async createInvoice({
      merchantCode: requestedMerchant, merchantOrderId, amount,
      paymentMethod = 'BT', customerEmail, customerName
    }) {
      if (requestedMerchant !== merchantCode) throw new Error('merchant_mismatch');
      configString(merchantOrderId, 'order_id', ID);
      const idr = positiveIdr(amount);
      if (paymentMethod !== 'BT') throw new Error('sandbox_bt_only');
      configString(customerEmail, 'customer_email', EMAIL);
      if (customerEmail.length > 254) throw new TypeError('invalid_customer_email');
      configString(customerName, 'customer_name', /^[A-Za-z0-9 .'-]{1,20}$/);
      const reply = await call('v2/inquiry', {
        merchantCode, merchantOrderId, paymentAmount: Number(idr),
        paymentMethod: 'BT',
        productDetails: 'BOR AI variable amount SANDBOX - no real customer credit',
        email: customerEmail, customerVaName: customerName,
        itemDetails: [{ name: 'BOR AI sandbox verification', price: Number(idr), quantity: 1 }],
        callbackUrl: origin + '/api/billing-sandbox/callback',
        returnUrl: origin + '/api/billing-sandbox/return',
        expiryPeriod: 10,
        signature: await duitkuSignature(apiKey, merchantCode + merchantOrderId + idr)
      });
      if (reply.statusCode !== '00' || reply.merchantCode !== merchantCode ||
          String(reply.amount) !== idr || !REF.test(reply.reference || '') ||
          !validSandboxPaymentUrl(reply.paymentUrl))
        throw new Error('duitku_sandbox_invoice_mismatch');
      return Object.freeze({
        merchantCode, merchantOrderId, amount: idr, reference: reply.reference,
        paymentUrl: reply.paymentUrl, statusCode: '00'
      });
    },
    async checkStatus({merchantCode: requestedMerchant, merchantOrderId, reference}) {
      if (requestedMerchant !== merchantCode) throw new Error('merchant_mismatch');
      configString(merchantOrderId, 'order_id', ID);
      configString(reference, 'reference', REF);
      const reply = await call('transactionStatus', {
        merchantCode, merchantOrderId,
        signature: await duitkuSignature(apiKey, merchantCode + merchantOrderId)
      });
      if (reply.merchantOrderId !== merchantOrderId ||
          reply.reference !== reference ||
          !NUMBER.test(String(reply.amount)) ||
          !['00','01','02'].includes(reply.statusCode))
        throw new Error('duitku_sandbox_status_mismatch');
      // Duitku V2 transactionStatus does NOT send a "currency" field.
      // IDR is fixed by this specific API integration and is asserted again
      // against the immutable IDR billing quote by the calling bridge.
      return Object.freeze({
        merchantOrderId,reference,amount:String(reply.amount),
        statusCode:reply.statusCode,currency:'IDR'
      });
    }
    // Intentionally NO checkReversal: the V2 status response is not
    // evidence of refund or chargeback settlement. No refund API invoked.
  });
}
