// Review-only sandbox fulfillment. Not wired to any route or production worker.
// D1 batch executes statements in one transaction; never execute them separately.
import {assessMidtransSandboxNotification} from "./midtrans-webhook-assessment.js";
import {checkMidtransSandboxOrder} from "./midtrans-status-api.js";
import {decideSandboxPaymentConfirmation} from "./midtrans-sandbox-payment-decision.js";
const SAFE_ID=/^[A-Za-z0-9_-]{1,100}$/;
export async function fulfillVerifiedSandboxPayment({db,orderId,payload,serverKey,expectedMerchantId,fetchImpl,now=Date.now}) {
  if (!db || typeof db.prepare!=="function" || typeof db.batch!=="function")
    throw new TypeError("Transactional D1 adapter required");
  if (typeof orderId!=="string" || !SAFE_ID.test(orderId)) throw new TypeError("Safe order ID required");
  if (typeof expectedMerchantId!=="string" || !expectedMerchantId.trim()) throw new TypeError("Merchant configuration required");
  const row=await db.prepare("SELECT order_id,user_id,amount_idr,currency,environment,state,provider_transaction_id FROM payment_orders WHERE order_id=?").bind(orderId).first();
  if (!row || row.environment!=="sandbox" || !["created","pending","paid_unfulfilled","fulfilled"].includes(row.state))
    return {kind:"not_confirmed",reason:"order_not_eligible"};
  const order={orderId:row.order_id,amountIdr:row.amount_idr,currency:row.currency,environment:row.environment};
  // Never take the assessment or status-API proof from request body.
  const webhook=await assessMidtransSandboxNotification(order,payload,{serverKey,expectedMerchantId});
  const statusApi=await checkMidtransSandboxOrder(order,{serverKey,expectedMerchantId,fetchImpl});
  const decision=decideSandboxPaymentConfirmation(order,webhook,statusApi);
  if(decision.kind!=="verified_paid_candidate") return decision;
  if(row.provider_transaction_id!==null && row.provider_transaction_id!==decision.providerTransactionId)
    return {kind:"not_confirmed",reason:"provider_transaction_mismatch"};
  const timestamp=now();
  if(!Number.isSafeInteger(timestamp) || timestamp<=0) throw new TypeError("Invalid timestamp");
  // Conditional compare-and-set prevents concurrent callbacks from double-granting.
  // D1 batch is atomic; the SQL trigger grants the ledger credit on fulfillment.
  const statements=[
    db.prepare("UPDATE payment_orders SET state='paid_unfulfilled',provider_transaction_id=?,updated_at=? WHERE order_id=? AND environment='sandbox' AND state IN ('created','pending') AND (provider_transaction_id IS NULL OR provider_transaction_id=?)").bind(decision.providerTransactionId,timestamp,orderId,decision.providerTransactionId),
    db.prepare("UPDATE payment_orders SET state='fulfilled',updated_at=? WHERE order_id=? AND environment='sandbox' AND state='paid_unfulfilled' AND provider_transaction_id=?").bind(timestamp,orderId,decision.providerTransactionId)
  ];
  // Do not retry failed batches blindly. Re-read DB after errors.
  const result=await db.batch(statements);
  const updated=result?.[1]?.meta?.changes;
  if(updated===1) return {kind:"fulfilled",orderId,providerTransactionId:decision.providerTransactionId};
  if(updated===0) return {kind:"unchanged",orderId};
  throw new Error("Unexpected D1 batch result");
}
