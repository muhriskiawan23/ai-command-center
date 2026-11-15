// Shared fulfillment for the isolated Midtrans sandbox Worker.
// D1 batch executes statements in one transaction; never execute them separately.
import {assessMidtransSandboxNotification} from "./midtrans-webhook-assessment.js";
import {checkMidtransSandboxOrder} from "./midtrans-status-api.js";
import {decideSandboxPaymentConfirmation} from "./midtrans-sandbox-payment-decision.js";
const SAFE_ID=/^[A-Za-z0-9_-]{1,100}$/;
export function fulfillVerifiedSandboxPayment(options) {
  const {payload,serverKey,signatureKey,expectedMerchantId,fetchImpl}=options;
  return fulfillSandboxOrder(options,async(order)=>{
    const webhook=await assessMidtransSandboxNotification(order,payload,{serverKey,signatureKey,expectedMerchantId});
    const status=await checkMidtransSandboxOrder(order,{serverKey,expectedMerchantId,fetchImpl});
    return decideSandboxPaymentConfirmation(order,webhook,status);
  });
}

// Only the authenticated sandbox operator route may initiate reconciliation.
export function reconcileSandboxPayment(options) {
  const {serverKey,expectedMerchantId,fetchImpl}=options;
  return fulfillSandboxOrder(options,async(order)=>{
    const status=await checkMidtransSandboxOrder(order,{serverKey,expectedMerchantId,fetchImpl,requireCurrency:true});
    if(status.classification.kind!=="paid_candidate")
      return {kind:"not_confirmed",reason:"status_not_paid"};
    return {kind:"verified_paid_candidate",providerTransactionId:status.providerTransactionId};
  });
}

async function fulfillSandboxOrder({db,orderId,expectedMerchantId,now=Date.now},verify) {
  if (!db || typeof db.prepare!=="function" || typeof db.batch!=="function")
    throw new TypeError("Transactional D1 adapter required");
  if (typeof orderId!=="string" || !SAFE_ID.test(orderId)) throw new TypeError("Safe order ID required");
  if (typeof expectedMerchantId!=="string" || !expectedMerchantId.trim()) throw new TypeError("Merchant configuration required");
  const row=await db.prepare("SELECT order_id,amount_idr,currency,environment,state,provider_transaction_id FROM payment_orders WHERE order_id=?").bind(orderId).first();
  if (!row || row.environment!=="sandbox" || !["created","pending","paid_unfulfilled","fulfilled"].includes(row.state))
    return {kind:"not_confirmed",reason:"order_not_eligible"};
  const order={orderId:row.order_id,amountIdr:row.amount_idr,currency:row.currency,environment:row.environment};
  const decision=await verify(order);
  if(decision.kind!=="verified_paid_candidate") return decision;
  if(row.provider_transaction_id!==null && row.provider_transaction_id!==decision.providerTransactionId)
    return {kind:"not_confirmed",reason:"provider_transaction_mismatch"};
  const timestamp=now();
  if(!Number.isSafeInteger(timestamp) || timestamp<=0) throw new TypeError("Invalid timestamp");
  // Conditional compare-and-set prevents concurrent callbacks from double-granting.
  // D1 batch is atomic; the SQL trigger grants the ledger credit on fulfillment.
  const statements=[
    db.prepare("UPDATE payment_orders SET state='paid_unfulfilled',provider_transaction_id=?,updated_at=? WHERE order_id=? AND environment='sandbox' AND state IN ('created','pending') AND (provider_transaction_id IS NULL OR provider_transaction_id=?)").bind(decision.providerTransactionId,timestamp,orderId,decision.providerTransactionId),
    db.prepare("UPDATE payment_orders SET state='fulfilled',updated_at=? WHERE order_id=? AND environment='sandbox' AND state='paid_unfulfilled' AND provider_transaction_id=? RETURNING order_id").bind(timestamp,orderId,decision.providerTransactionId)
  ];
  // Do not retry failed batches blindly. Re-read DB after errors.
  const result=await db.batch(statements);
  // D1's change count can include trigger writes to the account and ledger.
  const orders=result?.[1]?.results;
  if(Array.isArray(orders) && orders.length===1 && orders[0]?.order_id===orderId)
    return {kind:"fulfilled",orderId,providerTransactionId:decision.providerTransactionId};
  if(Array.isArray(orders) && orders.length===0) return {kind:"unchanged",orderId};
  throw new Error("Unexpected D1 batch result");
}
