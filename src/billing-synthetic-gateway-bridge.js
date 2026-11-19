// OFFLINE ONLY — authenticated billing workflow with a fake Duitku-compatible gateway.
// Never import this from a production Worker route. No provider network calls,
// customer payment, monetary refund or real credit entitlement is possible here.
import { sha256Hex } from './http.js';
import { duitkuSignature } from './duitku-sandbox-worker.js';
import {
  createSyntheticBillingQuote,createSyntheticBillingOrder,bindSyntheticInvoiceReference,
  recordSyntheticBillingEvent,getBillingWalletAudit
} from './billing-ledger-foundation.js';

export const SYNTHETIC_GATEWAY_BRIDGE_MODE = 'offline_no_real_payments_or_entitlements';
const idPattern=/^[A-Za-z0-9:_-]{10,90}$/;
const refPattern=/^[A-Za-z0-9_-]{1,255}$/;
const sigPattern=/^[a-f0-9]{64}$/;
const enc=new TextEncoder();
function requireId(value,label){
  if(typeof value!=='string'||!idPattern.test(value))throw new TypeError('invalid_'+label);
  return value;
}
function requireTimestamp(value){
  if(!Number.isSafeInteger(value)||value<0)throw new TypeError('invalid_timestamp');
  return value;
}
function requireProvider(provider,operation){
  const allowed = provider?.syntheticGatewayForTestsOnly===true ||
    (operation!=='checkReversal' && provider?.sandboxV2TransportOnly===true);
  if(!allowed||typeof provider[operation]!=='function')
    throw new Error('sandbox_or_synthetic_gateway_only');
  return provider;
}
function requireMerchant(merchantCode){
  if(typeof merchantCode!=='string'||!/^DS\d+$/.test(merchantCode))
    throw new Error('sandbox_merchant_only');
  return merchantCode;
}
function equalConstantTime(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let n=0;
  for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);
  return n===0;
}
function amountString(value){
  if(typeof value!=='string'||!/^[1-9]\d{0,11}$/.test(value))throw new Error('invalid_provider_amount');
  return value;
}
function compatibleOrder(order){
  if(!order||order.provider!=='duitku'||!order.provider_reference||
     !refPattern.test(order.provider_reference))throw new Error('unbound_synthetic_invoice');
  return order;
}
async function getOrder(db,orderId){
  requireId(orderId,'order_id');
  return db.prepare('SELECT o.*,q.quoted_idr,q.proposed_credits,q.sku,q.price_usd_micro,q.fx_source,q.fx_rate_micro_idr_per_usd,q.expires_at FROM billing_orders o JOIN billing_quotes q ON q.id=o.quote_id WHERE o.id=?')
    .bind(orderId).first();
}
// Matches BOR AI's existing signed-in sessions (SHA-256 cookie token, expiry in seconds).
// No browser-supplied userId, name or email is accepted as account proof.
export async function resolveOfflineBillingSession(db,{sessionToken,nowMs}){
  requireTimestamp(nowMs);
  if(typeof sessionToken!=='string'||sessionToken.length<24||sessionToken.length>512)
    throw new Error('authentication_required');
  const tokenHash=await sha256Hex(sessionToken);
  const person=await db.prepare(
    'SELECT users.id FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?'
  ).bind(tokenHash,Math.floor(nowMs/1000)).first();
  if(!person?.id)throw new Error('authentication_required');
  return person.id;
}
// Quotes and amount are chosen by server-only policyForSku(), not a customer price.
export async function startOfflineDuitkuCheckout({
  db,sessionToken,sku,quoteId,orderId,nowMs,policyForSku,provider,merchantCode
}){
  requireTimestamp(nowMs);requireId(quoteId,'quote_id');requireId(orderId,'order_id');
  requireMerchant(merchantCode);requireProvider(provider,'createInvoice');
  const userId=await resolveOfflineBillingSession(db,{sessionToken,nowMs});
  if(!['basic','pro','topup'].includes(sku))throw new Error('unsupported_sku');
  // Existing orders always return their original locked quote, even after
  // its expiry or a pricing-policy update; never issue a second invoice.
  const existingOrder=await getOrder(db,orderId);
  if(existingOrder){
    if(existingOrder.user_id!==userId||existingOrder.quote_id!==quoteId||existingOrder.sku!==sku)
      throw new Error('order_idempotency_conflict');
    return Object.freeze({
      orderId,quoteId,status:existingOrder.provider_reference?'invoice_previously_issued':'invoice_creation_unknown',
      amountIdr:existingOrder.quoted_idr,reference:existingOrder.provider_reference,
      paymentUrl:existingOrder.sandbox_payment_url??null,
      duplicate:true,synthetic:true,realCreditsGranted:false
    });
  }
  if(typeof policyForSku!=='function')throw new Error('missing_server_pricing_policy');
  const policy=await policyForSku(sku,nowMs);
  if(!policy||policy.sku!==sku||policy.issuedAtMs!==nowMs)
    throw new Error('invalid_server_pricing_policy');
  const quote=await createSyntheticBillingQuote(db,{quoteId,userId,...policy});
  const order=await createSyntheticBillingOrder(db,{orderId,quoteId,userId,nowMs});
  if(order.duplicate){
    const existing=await getOrder(db,orderId);
    if(!existing||existing.user_id!==userId)throw new Error('order_owner_mismatch');
    // Never create another invoice after an ambiguous provider timeout.
    return Object.freeze({
      orderId,quoteId,status:existing.provider_reference?'invoice_previously_issued':'invoice_creation_unknown',
      amountIdr:existing.quoted_idr,reference:existing.provider_reference,
      duplicate:true,synthetic:true,realCreditsGranted:false
    });
  }
  const amountIdr=String(quote.lockedIdr);
  const invoice=await provider.createInvoice({
    merchantCode,merchantOrderId:orderId,amount:amountIdr,paymentMethod:'BT',
    // Explicit SANDBOX-only customer identity avoids sending Google profile PII
    // to a test merchant. No invoice is ever created on the production gateway.
    customerEmail:'bor-ai-sandbox@example.test',customerName:'BOR AI Sandbox'
  });
  if(invoice?.merchantCode!==merchantCode||invoice?.merchantOrderId!==orderId||
     invoice?.amount!==amountIdr||invoice?.statusCode!=='00'||
     !refPattern.test(invoice?.reference??''))
    throw new Error('synthetic_invoice_mismatch');
  await bindSyntheticInvoiceReference(db,{orderId,userId,providerReference:invoice.reference});
  if(provider.sandboxV2TransportOnly===true){
    if(typeof invoice.paymentUrl!=='string'||!invoice.paymentUrl.startsWith('https://sandbox.duitku.com/'))
      throw new Error('invalid_sandbox_payment_url');
    await db.prepare("UPDATE billing_orders SET sandbox_payment_url=? WHERE id=? AND user_id=? AND status='pending' AND sandbox_payment_url IS NULL")
      .bind(invoice.paymentUrl,orderId,userId).run();
  }
  return Object.freeze({
    orderId,quoteId,sku,amountIdr:Number(amountIdr),reference:invoice.reference,
    paymentUrl:provider.sandboxV2TransportOnly===true?invoice.paymentUrl:null,
    fxQuoteExpiresAtMs:quote.expiresAtMs,status:'pending',duplicate:false,
    synthetic:true,checkoutEnabled:false,realCreditsGranted:false
  });
}
function parseSyntheticCallback(callback){
  const form=typeof callback==='string'?new URLSearchParams(callback):callback;
  if(!(form instanceof URLSearchParams)||form.toString().length>4096)
    throw new Error('invalid_callback_body');
  const required=['merchantCode','amount','merchantOrderId','reference','resultCode','signature'];
  // Duitku V2 may include signed-callback metadata; never use untrusted extras
  // to authorize payment. Reject unknown keys and ALL duplicated keys.
  const optional=new Set(['productDetail','productDetails','additionalParam','paymentCode',
    'merchantUserId','publisherOrderId','spUserHash','settlementDate','issuerCode','customerName']);
  const keys=[...form.keys()];
  if(required.some(k=>form.getAll(k).length!==1)||
    keys.some(k=>(!required.includes(k)&&!optional.has(k))||form.getAll(k).length!==1))
    throw new Error('invalid_callback_fields');
  const data=Object.fromEntries(required.map(k=>[k,form.get(k)]));
  if(!idPattern.test(data.merchantOrderId||'')||!refPattern.test(data.reference||'')||
    !['00','01'].includes(data.resultCode)||!sigPattern.test(data.signature||''))
    throw new Error('invalid_callback_parameters');
  amountString(data.amount);
  return data;
}
// Callback resultCode cannot credit the user. The fake backend status lookup
// must independently agree on order, reference and locked IDR amount.
export async function verifyOfflineDuitkuCallback({
  db,callback,provider,merchantCode,apiKey,nowMs
}){
  requireTimestamp(nowMs);requireMerchant(merchantCode);requireProvider(provider,'checkStatus');
  if(typeof apiKey!=='string'||apiKey.length<10)throw new Error('missing_synthetic_secret');
  const data=parseSyntheticCallback(callback);
  if(data.merchantCode!==merchantCode)throw new Error('merchant_mismatch');
  const expected=await duitkuSignature(apiKey,merchantCode+data.amount+data.merchantOrderId);
  if(!equalConstantTime(data.signature,expected))throw new Error('invalid_callback_signature');
  const order=compatibleOrder(await getOrder(db,data.merchantOrderId));
  if(String(order.quoted_idr)!==data.amount||order.provider_reference!==data.reference)
    throw new Error('callback_order_amount_or_reference_mismatch');
  if(order.status!=='pending'){
    return Object.freeze({
      orderId:order.id,status:order.status,duplicate:true,synthetic:true,realCreditsGranted:false
    });
  }
  if(provider.sandboxV2TransportOnly===true){
    // Bound external checks: provider explicitly warns against rapid polling.
    const claim=await db.prepare("UPDATE billing_orders SET sandbox_status_check_after=? WHERE id=? AND status='pending' AND sandbox_status_check_after<=?")
      .bind(nowMs+30000,order.id,nowMs).run();
    if(!claim.meta?.changes)throw new Error('sandbox_status_retry_later');
  }
  const status=await provider.checkStatus({merchantCode,merchantOrderId:order.id,reference:order.provider_reference});
  if(status?.merchantOrderId!==order.id||status?.reference!==order.provider_reference||
     status?.amount!==String(order.quoted_idr)||status?.currency!=='IDR'||
     !['00','01','02'].includes(status?.statusCode))
    throw new Error('provider_status_mismatch');
  if(status.statusCode!=='00')return {
    orderId:order.id,status:status.statusCode==='01'?'pending':'provider_failed',
    duplicate:false,synthetic:true,realCreditsGranted:false
  };
  const args={
    eventKey:'BPE:paid:'+order.id,orderId:order.id,eventType:'payment_verified',
    providerReference:order.provider_reference,amountIdr:order.quoted_idr,checkedAtMs:nowMs
  };
  let duplicate=false;
  try {
    const settled=await recordSyntheticBillingEvent(db,args);
    duplicate=settled.duplicate;
  }catch(error){
    // A parallel callback may have committed first. Accept only if the SAME
    // order/reference is now paid and its ledger is reconciled exactly once.
    const latest=await getOrder(db,order.id);
    const grant=await db.prepare("SELECT COUNT(*) AS n FROM billing_credit_ledger WHERE order_id=? AND event_type='grant'")
      .bind(order.id).first();
    const wallet=await getBillingWalletAudit(db,order.user_id);
    if(latest?.status!=='paid'||latest.provider_reference!==order.provider_reference||
       grant?.n!==1||!wallet.reconciled)throw error;
    duplicate=true;
  }
  const checked=await getBillingWalletAudit(db,order.user_id);
  if(!checked.reconciled)throw new Error('wallet_reconciliation_failed');
  return Object.freeze({
    orderId:order.id,status:'paid',duplicate,synthetic:true,realCreditsGranted:false
  });
}
export async function readOfflineCustomerOrder({
  db,sessionToken,orderId,nowMs
}){
  const userId=await resolveOfflineBillingSession(db,{sessionToken,nowMs});
  const order=await getOrder(db,orderId);
  if(!order||order.user_id!==userId)throw new Error('order_not_found');
  const wallet=await getBillingWalletAudit(db,userId);
  return Object.freeze({
    orderId:order.id,sku:order.sku,amountIdr:order.quoted_idr,
    status:order.status,availableCredits:wallet.availableCredits,
    debtCredits:wallet.debtCredits,reconciled:wallet.reconciled,
    synthetic:true,realCreditsGranted:false
  });
}
// This verifies a *mock* source-of-truth refund/chargeback receipt. No request
// for an actual refund is sent. Operator auth is independently injected and
// must be verified BEFORE any provider status read or credit reversal.
export async function reconcileOfflineProviderReversal({
  db,operatorToken,authorizeOperator,provider,orderId,eventType,nowMs
}){
  requireTimestamp(nowMs);requireId(orderId,'order_id');requireProvider(provider,'checkReversal');
  if(typeof authorizeOperator!=='function'||await authorizeOperator(operatorToken)!==true)
    throw new Error('operator_authorization_required');
  if(!['refund_verified','chargeback_verified'].includes(eventType))
    throw new Error('invalid_reversal_type');
  const order=compatibleOrder(await getOrder(db,orderId));
  const expectedStatus=eventType==='refund_verified'?'refunded':'chargeback';
  if(order.status==='refunded'||order.status==='chargeback'){
    if(order.status!==expectedStatus)throw new Error('conflicting_terminal_reversal');
    return {orderId,status:order.status,duplicate:true,synthetic:true,moneyRefundExecuted:false};
  }
  if(order.status!=='paid')throw new Error('reversal_requires_paid_order');
  const proof=await provider.checkReversal({merchantOrderId:order.id,reference:order.provider_reference,eventType});
  if(proof?.merchantOrderId!==order.id||proof?.reference!==order.provider_reference||
     proof?.amount!==String(order.quoted_idr)||proof?.currency!=='IDR'||
     proof?.status!==expectedStatus||typeof proof?.reversalId!=='string'||
     !refPattern.test(proof.reversalId))
    throw new Error('unverified_or_partial_reversal');
  const args={
    eventKey:'BPE:'+expectedStatus+':'+order.id,orderId:order.id,eventType,
    providerReference:order.provider_reference,amountIdr:order.quoted_idr,checkedAtMs:nowMs
  };
  let duplicate=false;
  try{
    const result=await recordSyntheticBillingEvent(db,args);
    duplicate=result.duplicate;
  }catch(error){
    const latest=await getOrder(db,order.id);
    const l=await db.prepare('SELECT COUNT(*) AS n FROM billing_credit_ledger WHERE order_id=? AND event_type=?')
      .bind(order.id,expectedStatus==='refunded'?'refund':'chargeback').first();
    const wallet=await getBillingWalletAudit(db,order.user_id);
    if(latest?.status!==expectedStatus||l?.n!==1||!wallet.reconciled)throw error;
    duplicate=true;
  }
  const wallet=await getBillingWalletAudit(db,order.user_id);
  if(!wallet.reconciled)throw new Error('wallet_reconciliation_failed');
  return Object.freeze({
    orderId,status:expectedStatus,duplicate,availableCredits:wallet.availableCredits,
    debtCredits:wallet.debtCredits,moneyRefundExecuted:false,
    synthetic:true,realCreditsGranted:false
  });
}
