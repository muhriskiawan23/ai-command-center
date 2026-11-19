// OFFLINE / isolated staging only. NOT a live Duitku Subscription API integration.
// Never import into production Worker or public routes. The caller must supply
// a previously authenticated synthetic user ID; all payment evidence is read
// from immutable D1 order/payment/ledger tables, not a browser assertion.
const ID=/^[A-Za-z0-9:_-]{10,90}$/;
function checkedUser(userId){
  if(typeof userId!=='string'||!userId.trim()||userId.length>255)
    throw new TypeError('authenticated user ID required');
  return userId;
}
function checkedOrder(orderId){
  if(typeof orderId!=='string'||!ID.test(orderId))
    throw new TypeError('valid synthetic order ID required');
  return orderId;
}
function checkedTime(nowMs){
  if(!Number.isSafeInteger(nowMs)||nowMs<0||!Number.isFinite(new Date(nowMs).getTime()))
    throw new TypeError('finite nonnegative timestamp required');
  return nowMs;
}
export function nextUtcCalendarMonth(startMs){
  checkedTime(startMs);
  const d=new Date(startMs);
  const year=d.getUTCFullYear(),month=d.getUTCMonth(),day=d.getUTCDate();
  const maxDay=new Date(Date.UTC(year,month+2,0)).getUTCDate();
  const end=Date.UTC(year,month+1,Math.min(day,maxDay),
    d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds(),d.getUTCMilliseconds());
  if(!Number.isSafeInteger(end)||end<=startMs||
    end-startMs>32*86400000)throw new RangeError('invalid calendar-month term');
  return end;
}
async function getTerm(db,orderId){
  return db.prepare('SELECT * FROM billing_subscription_terms WHERE order_id=?')
    .bind(orderId).first();
}
function termResult(term,duplicate=false){
  return Object.freeze({
    orderId:term.order_id,userId:term.user_id,sku:term.sku,
    periodStartMs:term.period_start_ms,periodEndMs:term.period_end_ms,
    cancelAtPeriodEnd:term.cancel_at_period_end===1,
    revokedReason:term.revoked_reason??null,
    renewalMode:'manual_only',automaticDebitEnabled:false,
    duplicate,synthetic:true,realCreditsGranted:false
  });
}
export async function issueManualSyntheticSubscription(db,{userId,orderId,nowMs}){
  checkedUser(userId);checkedOrder(orderId);checkedTime(nowMs);
  const existing=await getTerm(db,orderId);
  if(existing){
    if(existing.user_id!==userId)throw new Error('subscription_term_owner_mismatch');
    return termResult(existing,true);
  }
  const order=await db.prepare(`SELECT o.status,o.user_id,q.sku,o.updated_at
    FROM billing_orders o JOIN billing_quotes q ON q.id=o.quote_id
    WHERE o.id=?`).bind(orderId).first();
  if(!order||order.user_id!==userId)
    throw new Error('subscription_term_owner_mismatch');
  if(order.status!=='paid'||!['basic','pro'].includes(order.sku)||
    order.updated_at>nowMs)
    throw new Error('subscription_term_requires_verified_paid_order');
  const previous=await db.prepare(`SELECT MAX(period_end_ms) AS last_end
    FROM billing_subscription_terms WHERE user_id=? AND revoked_at_ms IS NULL`)
    .bind(userId).first();
  const start=Math.max(nowMs,previous?.last_end??nowMs);
  const end=nextUtcCalendarMonth(start);
  try{
    await db.prepare(`INSERT INTO billing_subscription_terms
      (order_id,user_id,sku,period_start_ms,period_end_ms,issued_at_ms,
       renewal_mode,cancel_at_period_end)
      VALUES(?,?,?,?,?,?,'manual_only',0)`)
      .bind(orderId,userId,order.sku,start,end,nowMs).run();
  }catch(e){
    // Concurrent repeat of the same paid order must not create two terms.
    const later=await getTerm(db,orderId);
    if(later?.user_id===userId)return termResult(later,true);
    throw e;
  }
  return termResult(await getTerm(db,orderId));
}
export async function readManualSyntheticEntitlement(db,{userId,nowMs}){
  checkedUser(userId);checkedTime(nowMs);
  const current=await db.prepare(`SELECT t.* FROM billing_subscription_terms t
    JOIN billing_orders o ON o.id=t.order_id
    WHERE t.user_id=? AND t.period_start_ms<=? AND t.period_end_ms>?
      AND t.revoked_at_ms IS NULL AND o.status='paid'
    ORDER BY t.period_start_ms DESC LIMIT 1`)
    .bind(userId,nowMs,nowMs).first();
  return Object.freeze({
    active:!!current,
    sku:current?.sku??null,orderId:current?.order_id??null,
    periodEndMs:current?.period_end_ms??null,
    cancelAtPeriodEnd:current?.cancel_at_period_end===1,
    renewalMode:'manual_only',automaticDebitEnabled:false,
    // There is no real BOR AI entitlement from this isolated prototype.
    realCreditsGranted:false,realSubscriptionEnabled:false,synthetic:true
  });
}
export async function cancelManualSyntheticRenewal(db,{userId,orderId,nowMs}){
  checkedUser(userId);checkedOrder(orderId);checkedTime(nowMs);
  const before=await getTerm(db,orderId);
  if(!before||before.user_id!==userId)throw new Error('subscription_term_owner_mismatch');
  if(before.revoked_at_ms!==null)throw new Error('subscription_term_already_revoked');
  if(before.cancel_at_period_end===1)return termResult(before,true);
  if(nowMs<before.issued_at_ms)throw new Error('subscription_cancel_before_issue');
  await db.prepare(`UPDATE billing_subscription_terms
    SET cancel_at_period_end=1
    WHERE order_id=? AND user_id=? AND cancel_at_period_end=0`)
    .bind(orderId,userId).run();
  const after=await getTerm(db,orderId);
  if(after?.cancel_at_period_end!==1)throw new Error('subscription_cancellation_failed');
  return termResult(after);
}
export async function revokeManualSyntheticTerm(db,{userId,orderId,
  nowMs,verifiedReason}){
  checkedUser(userId);checkedOrder(orderId);checkedTime(nowMs);
  if(!['refund','chargeback'].includes(verifiedReason))
    throw new TypeError('a verified refund or chargeback reason is required');
  const before=await getTerm(db,orderId);
  if(!before||before.user_id!==userId)throw new Error('subscription_term_owner_mismatch');
  if(before.revoked_at_ms!==null){
    if(before.revoked_reason!==verifiedReason)
      throw new Error('subscription_reversal_conflict');
    return termResult(before,true);
  }
  if(nowMs<before.issued_at_ms)throw new Error('subscription_reversal_before_issue');
  // Database trigger requires a *matching, verified synthetic reversal event
  // AND its one ledger clawback* on this order. Input reason alone is not
  // accepted as money movement or provider evidence.
  await db.prepare(`UPDATE billing_subscription_terms
    SET revoked_at_ms=?,revoked_reason=?
    WHERE order_id=? AND user_id=? AND revoked_at_ms IS NULL`)
    .bind(nowMs,verifiedReason,orderId,userId).run();
  const after=await getTerm(db,orderId);
  if(after?.revoked_reason!==verifiedReason)
    throw new Error('subscription_reversal_conflict');
  return termResult(after);
}
