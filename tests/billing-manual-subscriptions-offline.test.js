import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {
  nextUtcCalendarMonth,issueManualSyntheticSubscription,
  readManualSyntheticEntitlement,cancelManualSyntheticRenewal,
  revokeManualSyntheticTerm
} from '../src/billing-manual-subscriptions-offline.js';
import {
  createSyntheticBillingQuote,createSyntheticBillingOrder,
  bindSyntheticInvoiceReference,recordSyntheticBillingEvent,
  recordSyntheticUsageDebit,getBillingWalletAudit
} from '../src/billing-ledger-foundation.js';

const NOW=Date.UTC(2026,0,31,10,30,0);
const USER='STAGE-subscription-owner-000001',OTHER='STAGE-unrelated-owner-000002';
const ORDER1='BSTAGE-SUBSCRIPTION-ORDER-00001';
const ORDER2='BSTAGE-SUBSCRIPTION-ORDER-00002';
function fixture(){
  const s=new DatabaseSync(':memory:');
  s.exec('PRAGMA foreign_keys=ON');
  for(const file of [
    '0001_staging_identity.sql','0002_billing_core.sql',
    '0003_invoice_reference_guard.sql','0004_invoice_recovery.sql',
    '0005_daily_invoice_quota.sql','0006_callback_diagnostic_buckets.sql',
    '0007_synthetic_usage_reservations.sql',
    '0008_manual_subscription_terms.sql'
  ])s.exec(readFileSync(new URL('../staging/billing/migrations/'+file,import.meta.url),'utf8'));
  const stmt=(query,args=[])=>({
    query,args,bind:(...v)=>stmt(query,v),
    first:async()=>s.prepare(query).get(...args)??null,
    all:async()=>({results:s.prepare(query).all(...args)}),
    run:async()=>({meta:{changes:Number(s.prepare(query).run(...args).changes)}})
  });
  const db={
    prepare:q=>stmt(q),
    async batch(items){
      s.exec('BEGIN IMMEDIATE');
      try{
        const out=items.map(({query,args})=>s.prepare(query).run(...args));
        s.exec('COMMIT');return out;
      }catch(e){s.exec('ROLLBACK');throw e}
    }
  };
  for(const id of [USER,OTHER])
    s.prepare('INSERT INTO users(id,email,name,picture,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(id,id+'@example.invalid','Synthetic','',NOW,NOW);
  const makeOrder=async(orderId,sku='basic',paid=true)=>{
    const seq=orderId===ORDER1?1:orderId===ORDER2?2:3;
    const quoteId='BQSTAGE-SUBSCRIPTION-'+seq;
    const credit=sku==='basic'?3000:15000;
    const amount=sku==='basic'?35821:125822;
    await createSyntheticBillingQuote(db,{
      quoteId,userId:USER,sku,proposedCredits:credit,
      proposedTariffVersion:'UNAPPROVED-OFFLINE-001',
      fxIdrPerUsd:'18000.25',fxSource:'offline-not-live',
      issuedAtMs:NOW,expiresAtMs:NOW+600000,
      gatewayMethod:'BT',gatewayFeeIdr:4000,gatewayFeeSource:'offline',
      gatewayFeeTaxIdr:480,providerBudgetUsd:sku==='basic'?'0.30':'1.50',
      fxReserveIdr:500,refundReserveIdr:700,otherVariableCostsIdr:1000,
      minimumContributionBps:2000
    });
    await createSyntheticBillingOrder(db,{orderId,quoteId,userId:USER,nowMs:NOW+100*seq});
    const ref='STAGE-REF-SUBSCRIPTION-'+seq;
    await bindSyntheticInvoiceReference(db,{orderId,userId:USER,providerReference:ref});
    if(paid)await recordSyntheticBillingEvent(db,{
      eventKey:'BPE:paid:'+orderId,orderId,eventType:'payment_verified',
      providerReference:ref,amountIdr:amount,checkedAtMs:NOW+500*seq
    });
    return {orderId,providerReference:ref,amountIdr:amount};
  };
  return {db,s,makeOrder,close:()=>s.close()};
}
const issue=(h,orderId=ORDER1,time=NOW+2000)=>
  issueManualSyntheticSubscription(h.db,{userId:USER,orderId,nowMs:time});
const status=(h,time=NOW+3000)=>
  readManualSyntheticEntitlement(h.db,{userId:USER,nowMs:time});

test('calendar-month term clamps Jan 31 to Feb 28, handles leap years and preserves UTC time',()=>{
  const jan31=Date.UTC(2026,0,31,10,30,25,123);
  assert.equal(nextUtcCalendarMonth(jan31),Date.UTC(2026,1,28,10,30,25,123));
  assert.equal(nextUtcCalendarMonth(Date.UTC(2028,0,31,6)),Date.UTC(2028,1,29,6));
  assert.equal(nextUtcCalendarMonth(Date.UTC(2026,11,15,23)),Date.UTC(2027,0,15,23));
  assert.throws(()=>nextUtcCalendarMonth(NaN),/timestamp/);
});

test('manual term requires prior verified payment and exactly-one ledger grant; no auto-debit',async()=>{
  const h=fixture();try{
    await h.makeOrder(ORDER1,'basic',false);
    await assert.rejects(()=>issue(h),/requires_verified_paid_order/);
    assert.equal((await status(h)).active,false);
    await recordSyntheticBillingEvent(h.db,{
      eventKey:'BPE:paid:'+ORDER1,orderId:ORDER1,eventType:'payment_verified',
      providerReference:'STAGE-REF-SUBSCRIPTION-1',amountIdr:35821,checkedAtMs:NOW+501
    });
    const term=await issue(h);
    assert.equal(term.sku,'basic');
    assert.equal(term.renewalMode,'manual_only');
    assert.equal(term.automaticDebitEnabled,false);
    assert.equal(term.realCreditsGranted,false);
    assert.equal(term.periodEndMs,Date.UTC(2026,1,28,10,30,2));
    assert.equal((await issue(h)).duplicate,true);
    assert.equal(h.s.prepare('SELECT COUNT(*) AS n FROM billing_subscription_terms').get().n,1);
    assert.equal((await status(h)).active,true);
    assert.equal((await status(h,term.periodEndMs)).active,false);
    assert.equal((await getBillingWalletAudit(h.db,USER)).availableCredits,3000);
  }finally{h.close()}
});

test('a second month requires a DISTINCT paid order and cannot steal the first monthly period',async()=>{
  const h=fixture();try{
    await h.makeOrder(ORDER1);const first=await issue(h);
    await h.makeOrder(ORDER2,'pro');
    const queued=await issue(h,ORDER2,NOW+2500);
    assert.equal(queued.sku,'pro');
    assert.equal(queued.periodStartMs,first.periodEndMs);
    assert.equal(queued.periodEndMs,nextUtcCalendarMonth(first.periodEndMs));
    assert.equal((await status(h,first.periodEndMs-1)).sku,'basic');
    assert.equal((await status(h,first.periodEndMs)).sku,'pro');
    assert.equal((await issue(h,ORDER2,NOW+3000)).duplicate,true);
    const draft=h.s.prepare('SELECT COUNT(*) AS n FROM billing_subscription_terms').get();
    assert.equal(draft.n,2);
    await assert.rejects(()=>issueManualSyntheticSubscription(h.db,{
      userId:OTHER,orderId:ORDER1,nowMs:NOW+3100
    }),/owner_mismatch/);
  }finally{h.close()}
});

test('cancel at period end retains current access but never creates an automatic renewal',async()=>{
  const h=fixture();try{
    await h.makeOrder(ORDER1);
    const term=await issue(h);
    const cancelled=await cancelManualSyntheticRenewal(h.db,{
      userId:USER,orderId:ORDER1,nowMs:NOW+4500
    });
    assert.equal(cancelled.cancelAtPeriodEnd,true);
    assert.equal((await cancelManualSyntheticRenewal(h.db,{
      userId:USER,orderId:ORDER1,nowMs:NOW+4600
    })).duplicate,true);
    assert.equal((await status(h,term.periodEndMs-1)).active,true);
    assert.equal((await status(h,term.periodEndMs)).active,false);
    assert.equal(h.s.prepare('SELECT COUNT(*) AS n FROM billing_subscription_terms').get().n,1);
    assert.equal((await status(h)).automaticDebitEnabled,false);
  }finally{h.close()}
});

test('refund/chargeback assertions alone cannot revoke; verified synthetic reversal and clawback do',async()=>{
  for(const kind of ['refund','chargeback']){
    const h=fixture();try{
      const order=await h.makeOrder(ORDER1);
      await issue(h);
      await assert.rejects(()=>revokeManualSyntheticTerm(h.db,{
        userId:USER,orderId:ORDER1,nowMs:NOW+6000,verifiedReason:kind
      }),/reversal_unverified/);
      assert.equal((await status(h)).active,true);
      await recordSyntheticBillingEvent(h.db,{
        eventKey:'BPE:'+kind+':'+ORDER1,orderId:ORDER1,
        eventType:kind==='refund'?'refund_verified':'chargeback_verified',
        providerReference:order.providerReference,amountIdr:order.amountIdr,
        checkedAtMs:NOW+5000
      });
      // Even if explicit revocation is delayed, order status immediately
      // blocks read-side entitlement because it is no longer 'paid'.
      assert.equal((await status(h,NOW+5200)).active,false);
      const revoked=await revokeManualSyntheticTerm(h.db,{
        userId:USER,orderId:ORDER1,nowMs:NOW+6000,verifiedReason:kind
      });
      assert.equal(revoked.revokedReason,kind);
      assert.equal((await revokeManualSyntheticTerm(h.db,{
        userId:USER,orderId:ORDER1,nowMs:NOW+7000,verifiedReason:kind
      })).duplicate,true);
      const other=kind==='refund'?'chargeback':'refund';
      await assert.rejects(()=>revokeManualSyntheticTerm(h.db,{
        userId:USER,orderId:ORDER1,nowMs:NOW+8000,verifiedReason:other
      }),/reversal_conflict/);
      assert.equal((await getBillingWalletAudit(h.db,USER)).reconciled,true);
      assert.equal(h.s.prepare('SELECT COUNT(*) AS n FROM billing_subscription_terms').get().n,1);
    }finally{h.close()}
  }
});

test('already spent credits create debt on chargeback and subscription remains inaccessible',async()=>{
  const h=fixture();try{
    const order=await h.makeOrder(ORDER1);
    await issue(h);
    await recordSyntheticUsageDebit(h.db,{
      userId:USER,requestId:'BILL-REAL-TIME-SPEND-TEST-01',credits:2500,createdAtMs:NOW+4000
    });
    await recordSyntheticBillingEvent(h.db,{
      eventKey:'BPE:chargeback:'+ORDER1,orderId:ORDER1,
      eventType:'chargeback_verified',providerReference:order.providerReference,
      amountIdr:order.amountIdr,checkedAtMs:NOW+5000
    });
    const wallet=await getBillingWalletAudit(h.db,USER);
    assert.equal(wallet.availableCredits,0);
    assert.equal(wallet.debtCredits,2500);
    assert.equal(wallet.spendingBlocked,true);
    assert.equal(wallet.reconciled,true);
    assert.equal((await status(h,NOW+5100)).active,false);
  }finally{h.close()}
});

test('subscription rows are immutable financial records; impossible claims are not accepted',async()=>{
  const h=fixture();try{
    await h.makeOrder(ORDER1);
    await issue(h);
    assert.throws(()=>h.s.prepare(
      'UPDATE billing_subscription_terms SET period_end_ms=period_end_ms+86400000 WHERE order_id=?'
    ).run(ORDER1),/snapshot_immutable/);
    assert.throws(()=>h.s.prepare('DELETE FROM billing_subscription_terms WHERE order_id=?')
      .run(ORDER1),/append_only/);
    await assert.rejects(()=>cancelManualSyntheticRenewal(h.db,{
      userId:OTHER,orderId:ORDER1,nowMs:NOW+3000
    }),/owner_mismatch/);
    await assert.rejects(()=>revokeManualSyntheticTerm(h.db,{
      userId:USER,orderId:ORDER1,nowMs:NOW+3000,verifiedReason:'paid'
    }),/verified refund or chargeback/);
    assert.equal((await status(h)).active,true);
  }finally{h.close()}
});
