// Off-line billing foundation. Not imported by HTTP routes, AI metering or Duitku Worker.
// Synthetic events ONLY. There is NO production settlement or wallet entitlement.
import { parseUsdMicro } from './credit-metering.js';
import { previewBillingQuote, BOR_BILLING_STATUS } from './billing-quote-core.js';
const BILLING_DISABLED = 'synthetic_only_no_live_checkout_or_credit_grant';
function identifier(value, label, max=90) {
  if (typeof value!=='string' || !/^[A-Za-z0-9:_-]+$/.test(value) || value.length<10 || value.length>max)
    throw new TypeError(label+' must be an ASCII identifier of length 10..'+max);
  return value;
}
function owner(value) {
  if(typeof value!=='string' || !value.trim() || value.length>255)throw new TypeError('authenticated user ID required');
  return value;
}
function safe(v,label){
  const n=typeof v==='bigint'?v:BigInt(v);
  if(n<0n||n>BigInt(Number.MAX_SAFE_INTEGER))throw new RangeError(label+' exceeds safe integer');
  return Number(n);
}
function natural(v,label){
  if(!Number.isSafeInteger(v)||v<0)throw new TypeError(label+' must be nonnegative safe integer');
  return v;
}
function nonempty(v,label,max=255){
  if(typeof v!=='string'||!v.trim()||v.length>max)throw new TypeError(label+' must be non-empty and bounded');
  return v;
}
const quoteColumns=[
  'id','user_id','sku','price_usd_micro','proposed_credits','tariff_version',
  'fx_rate_micro_idr_per_usd','fx_source','quoted_idr','gateway_method',
  'gateway_fee_idr','gateway_fee_source','gateway_fee_tax_idr','provider_budget_idr',
  'fx_reserve_idr','refund_reserve_idr','other_variable_costs_idr',
  'contribution_idr','required_contribution_idr','issued_at','expires_at'
];
export async function readBillingQuote(db, quoteId, userId){
  identifier(quoteId,'quoteId');owner(userId);
  return await db.prepare('SELECT * FROM billing_quotes WHERE id=? AND user_id=?').bind(quoteId,userId).first() || null;
}
// Called ONLY by an eventual authenticated server-owned quote allocator after
// approvals. Drafting a snapshot here does not create a Duitku invoice/charge.
export async function createSyntheticBillingQuote(db,{quoteId,userId,...policy}){
  identifier(quoteId,'quoteId');owner(userId);
  const q=previewBillingQuote(policy);
  if(q.status!==BOR_BILLING_STATUS||q.checkoutEnabled!==false||q.passesMarginScreen!==true)
    throw new RangeError('quote fails the offline margin screen');
  const values=[
    quoteId,userId,q.sku,safe(parseUsdMicro(q.priceUsd),'USD price'),
    safe(BigInt(q.proposedCredits),'credits'),q.proposedTariffVersion,
    safe(parseUsdMicro(q.fxIdrPerUsd),'fx'),q.fxSource,
    safe(BigInt(q.lockedIdrPreview),'IDR amount'),q.gatewayMethod,
    safe(BigInt(q.gatewayFeeIdr),'gateway fee'),q.gatewayFeeSource,
    safe(BigInt(q.gatewayFeeTaxIdr),'gateway fee tax'),
    safe(BigInt(q.providerBudgetIdr),'provider budget'),
    safe(BigInt(q.fxReserveIdr),'fx reserve'),
    safe(BigInt(q.refundReserveIdr),'refund reserve'),
    safe(BigInt(q.otherVariableCostsIdr),'other variable'),
    BigInt(q.contributionIdr)>=0n?safe(BigInt(q.contributionIdr),'contribution'):-safe(-BigInt(q.contributionIdr),'negative contribution'),
    safe(BigInt(q.requiredContributionIdr),'required contribution'),q.issuedAtMs,q.expiresAtMs
  ];
  const cols=quoteColumns.join(',');
  const place=quoteColumns.map(()=>'?').join(',');
  await db.prepare('INSERT INTO billing_quotes('+cols+') SELECT '+place+' WHERE NOT EXISTS (SELECT 1 FROM billing_quotes WHERE id=?)')
    .bind(...values,quoteId).run();
  const existing=await db.prepare('SELECT * FROM billing_quotes WHERE id=?').bind(quoteId).first();
  if(!existing||quoteColumns.some((key,i)=>existing[key]!==values[i]))
    throw new Error('quote_idempotency_conflict');
  return Object.freeze({
    quoteId,userId,sku:q.sku,priceUsd:q.priceUsd,lockedIdr:q.lockedIdrPreview,
    expiresAtMs:q.expiresAtMs,checkoutEnabled:false,synthetic:true,
    warning:'FX snapshot persisted in billing_quotes; no Duitku checkout enabled.'
  });
}
export async function createSyntheticBillingOrder(db,{orderId,quoteId,userId,nowMs}){
  identifier(orderId,'orderId');identifier(quoteId,'quoteId');owner(userId);natural(nowMs,'nowMs');
  // An order is a durable reference to an immutable, unexpired, owner-bound quote.
  // No provider API is called and no real invoice is issued.
  const found=await db.prepare('SELECT * FROM billing_orders WHERE id=?').bind(orderId).first();
  if(found){
    if(found.quote_id!==quoteId||found.user_id!==userId)throw new Error('order_idempotency_conflict');
    return {orderId,quoteId,userId,status:found.status,duplicate:true,checkoutEnabled:false};
  }
  await db.prepare("INSERT INTO billing_orders(id,quote_id,user_id,provider,status,created_at,updated_at) VALUES(?,?,?,'duitku','pending',?,?)")
    .bind(orderId,quoteId,userId,nowMs,nowMs).run();
  return {orderId,quoteId,userId,status:'pending',duplicate:false,checkoutEnabled:false};
}
// Bind the invoice reference returned by a trusted *synthetic* gateway fixture.
// No real Duitku checkout occurs; the reference is immutable once set.
export async function bindSyntheticInvoiceReference(db,{orderId,userId,providerReference}){
  identifier(orderId,'orderId');owner(userId);
  if(typeof providerReference!=='string'||!/^[A-Za-z0-9_-]{1,255}$/.test(providerReference))
    throw new TypeError('invalid provider reference');
  const order=await db.prepare('SELECT * FROM billing_orders WHERE id=?').bind(orderId).first();
  if(!order||order.user_id!==userId)throw new Error('order_owner_mismatch');
  if(order.provider_reference!==null){
    if(order.provider_reference!==providerReference)throw new Error('invoice_reference_conflict');
    return {orderId,providerReference,duplicate:true,synthetic:true};
  }
  if(order.status!=='pending')throw new Error('not_pending_invoice');
  await db.prepare("UPDATE billing_orders SET provider_reference=? WHERE id=? AND user_id=? AND provider_reference IS NULL AND status='pending'")
    .bind(providerReference,orderId,userId).run();
  const saved=await db.prepare('SELECT provider_reference FROM billing_orders WHERE id=?').bind(orderId).first();
  if(saved?.provider_reference!==providerReference)throw new Error('invoice_reference_conflict');
  return {orderId,providerReference,duplicate:false,synthetic:true};
}
export async function getBillingWalletAudit(db,userId){
  owner(userId);
  const row=await db.prepare('SELECT available_credits,debt_credits FROM billing_wallets WHERE user_id=?')
    .bind(userId).first();
  const total=await db.prepare("SELECT COALESCE(SUM(delta),0) AS net FROM billing_credit_ledger WHERE user_id=?")
    .bind(userId).first();
  const available=row?.available_credits??0, debt=row?.debt_credits??0, net=total?.net??0;
  return Object.freeze({
    userId,availableCredits:available,debtCredits:debt,netCredits:net,
    reconciled:available-debt===net,
    spendingBlocked:debt>0 || available===0,
    billingStatus:BILLING_DISABLED,
    // Not equivalent to currently enabled chat quota or image-wallet credits.
    realCustomerBillingEnabled:false
  });
}
// Deliberately synthetic: no real Duitku status is ever inferred from caller data.
// This function has no HTTP route and NEVER issues a monetary refund.
export async function recordSyntheticBillingEvent(db,{
  eventKey,orderId,eventType,providerReference,amountIdr,checkedAtMs
}){
  identifier(eventKey,'eventKey',160);
  identifier(orderId,'orderId');
  if(!['payment_verified','refund_verified','chargeback_verified'].includes(eventType))
    throw new TypeError('unsupported synthetic event');
  nonempty(providerReference,'providerReference');
  natural(amountIdr,'amountIdr');
  natural(checkedAtMs,'checkedAtMs');
  if(amountIdr===0)throw new TypeError('amountIdr must be positive');
  const prior=await db.prepare('SELECT * FROM billing_payment_events WHERE event_key=?').bind(eventKey).first();
  if(prior){
    if(prior.order_id!==orderId||prior.event_type!==eventType||prior.provider_reference!==providerReference||
      prior.amount_idr!==amountIdr)throw new Error('event_idempotency_conflict');
    return {orderId,eventType,duplicate:true,synthetic:true};
  }
  // Another event key for an already verified order is a retry, not a second grant.
  const previousType=await db.prepare('SELECT * FROM billing_payment_events WHERE order_id=? AND event_type=?')
    .bind(orderId,eventType).first();
  if(previousType){
    if(previousType.provider_reference!==providerReference||previousType.amount_idr!==amountIdr)
      throw new Error('order_event_conflict');
    return {orderId,eventType,duplicate:true,synthetic:true};
  }
  await db.prepare("INSERT INTO billing_payment_events(event_key,order_id,event_type,provider_reference,amount_idr,signature_checked,status_checked,verification_mode,checked_at) VALUES(?,?,?,?,?,1,1,'synthetic_test',?)")
    .bind(eventKey,orderId,eventType,providerReference,amountIdr,checkedAtMs).run();
  const order=await db.prepare('SELECT status FROM billing_orders WHERE id=?').bind(orderId).first();
  return {orderId,eventType,status:order?.status,duplicate:false,synthetic:true};
}
export async function recordSyntheticUsageDebit(db,{userId,requestId,credits,createdAtMs}){
  owner(userId);identifier(requestId,'requestId',160);natural(credits,'credits');natural(createdAtMs,'createdAtMs');
  if(credits===0||credits>1_000_000_000)throw new RangeError('usage credit bound');
  const prior=await db.prepare("SELECT delta FROM billing_credit_ledger WHERE user_id=? AND event_type='usage' AND source_key=?")
    .bind(userId,requestId).first();
  if(prior){
    if(prior.delta!==-credits)throw new Error('usage_idempotency_conflict');
    return {userId,credits,duplicate:true,synthetic:true};
  }
  const transactionId='BLEDGER:usage:'+crypto.randomUUID();
  // The SQL trigger guards balance and debt in the *same transaction* as debit.
  const write=await db.prepare("INSERT INTO billing_credit_ledger(id,user_id,order_id,event_type,source_key,delta,created_at) SELECT ?,?,NULL,'usage',?, ?,? WHERE NOT EXISTS (SELECT 1 FROM billing_credit_ledger WHERE user_id=? AND event_type='usage' AND source_key=?)")
    .bind(transactionId,userId,requestId,-credits,createdAtMs,userId,requestId).run();
  const saved=await db.prepare("SELECT delta FROM billing_credit_ledger WHERE user_id=? AND event_type='usage' AND source_key=?")
    .bind(userId,requestId).first();
  if(saved?.delta!==-credits)throw new Error('usage_idempotency_conflict');
  return {userId,credits,duplicate:!write.meta?.changes,synthetic:true};
}
