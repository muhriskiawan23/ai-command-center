import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  createSyntheticBillingQuote,createSyntheticBillingOrder,recordSyntheticBillingEvent,
  recordSyntheticUsageDebit,getBillingWalletAudit,readBillingQuote
} from '../src/billing-ledger-foundation.js';
const now=Date.UTC(2026,10,19,7,0,0);
let num=0;
const next=(kind)=>kind+'-'+String(++num).padStart(12,'0');
const ownerA='account-A-authenticated';
const ownerB='account-B-authenticated';
function setup(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../migrations/0001_auth_and_chat.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0013_billing_foundation.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0014_billing_invoice_reference_guard.sql',import.meta.url),'utf8'));
  for(const id of [ownerA,ownerB]){
    sqlite.prepare('INSERT INTO users(id,email,name,created_at,updated_at) VALUES(?,?,?,?,?)')
      .run(id,id+'@example.test','',now,now);
  }
  const stmt=(sql,args=[])=>({
    bind:(...v)=>stmt(sql,v),
    first:async()=>sqlite.prepare(sql).get(...args)??null,
    run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...args).changes)}})
  });
  const db={prepare:sql=>stmt(sql)};
  const policy={
    sku:'basic',proposedCredits:3000,proposedTariffVersion:'draft-review-2026-11',
    fxIdrPerUsd:'18000.25',fxSource:'synthetic-reference-not-live-FX',
    issuedAtMs:now,expiresAtMs:now+600000,
    gatewayMethod:'BT',gatewayFeeIdr:4000,gatewayFeeSource:'synthetic-unverified-fees',
    gatewayFeeTaxIdr:480,providerBudgetUsd:'0.30',
    fxReserveIdr:500,refundReserveIdr:700,otherVariableCostsIdr:1000,minimumContributionBps:2000
  };
  const q=async(changes={})=>createSyntheticBillingQuote(db,{
    quoteId:next('BQUOTE'),userId:ownerA,...policy,...changes
  });
  const order=async(quote,changes={})=>createSyntheticBillingOrder(db,{
    orderId:next('BORDER'),quoteId:quote.quoteId,userId:ownerA,nowMs:now+5000,...changes
  });
  const bindRef=(orderId,reference)=>{
    const invoice=sqlite.prepare('SELECT provider_reference FROM billing_orders WHERE id=?').get(orderId);
    if(!invoice)throw new Error('order missing');
    if(invoice.provider_reference===null)
      sqlite.prepare('UPDATE billing_orders SET provider_reference=? WHERE id=?').run(reference,orderId);
  };
  const pay=async(orderId,quote,changes={})=>{
    const invoice=sqlite.prepare('SELECT provider_reference FROM billing_orders WHERE id=?').get(orderId);
    const providerReference=changes.providerReference??invoice?.provider_reference??next('REF');
    bindRef(orderId,providerReference);
    return recordSyntheticBillingEvent(db,{
      eventKey:next('PAY-EVENT'),orderId,eventType:'payment_verified',providerReference,
      amountIdr:Number(quote.lockedIdr),checkedAtMs:now+20000,...changes
    });
  };
  const events=()=>sqlite.prepare('SELECT * FROM billing_payment_events ORDER BY event_key').all();
  const ledger=()=>sqlite.prepare('SELECT * FROM billing_credit_ledger ORDER BY id').all();
  const row=id=>sqlite.prepare('SELECT * FROM billing_orders WHERE id=?').get(id);
  return {sqlite,db,policy,q,order,pay,bindRef,events,ledger,row,close:()=>sqlite.close()};
}
test('D1 migration builds isolated immutable billing tables and leaves current image/chat accounting untouched',()=>{
  const h=setup();try{
    for(const table of ['billing_quotes','billing_orders','billing_payment_events','billing_wallets','billing_credit_ledger'])
      assert.ok(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
    assert.equal(h.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='image_wallets'").get(),undefined);
  }finally{h.close()}
});
test('FX snapshot is locked in D1, exact USD prices, one owner and maximum quote expiry',async()=>{
  const h=setup();try{
    const quote=await h.q();
    assert.equal(quote.priceUsd,'1.99');
    assert.equal(quote.lockedIdr,'35821');
    assert.equal(quote.checkoutEnabled,false);
    const raw=await readBillingQuote(h.db,quote.quoteId,ownerA);
    assert.equal(raw.price_usd_micro,1990000);
    assert.equal(raw.fx_rate_micro_idr_per_usd,18000250000);
    assert.equal(raw.quoted_idr,35821);
    assert.equal(await readBillingQuote(h.db,quote.quoteId,ownerB),null);
    assert.throws(()=>h.sqlite.prepare('UPDATE billing_quotes SET quoted_idr=1 WHERE id=?').run(quote.quoteId),/billing_quote_immutable/);
    assert.throws(()=>h.sqlite.prepare('DELETE FROM billing_quotes WHERE id=?').run(quote.quoteId),/billing_quote_immutable/);
    assert.equal((await h.order(quote)).status,'pending');
    await assert.rejects(()=>h.order(quote,{orderId:next('BORDER'),userId:ownerB}),/billing_quote_expired_or_wrong_owner/);
    await assert.rejects(()=>h.order(quote,{orderId:next('BORDER'),nowMs:now+600000}),/billing_quote_expired_or_wrong_owner/);
    await assert.rejects(()=>h.q({sku:'topup',topupPriceUsd:'0.10',proposedCredits:100}),/margin screen/);
    await assert.rejects(()=>h.q({sku:'basic',topupPriceUsd:'2.99'}),/fixed/);
  }finally{h.close()}
});
test('quote/order ID retries never change a persisted FX snapshot or owner',async()=>{
  const h=setup();try{
    const qid=next('BQUOTE');
    const first=await h.q({quoteId:qid});
    assert.equal((await h.q({quoteId:qid})).lockedIdr,first.lockedIdr);
    await assert.rejects(()=>h.q({quoteId:qid,fxIdrPerUsd:'18001'}),/quote_idempotency_conflict/);
    await assert.rejects(()=>h.q({quoteId:qid,userId:ownerB}),/quote_idempotency_conflict/);
    const oid=next('BORDER');
    const o=await h.order(first,{orderId:oid});
    const again=await h.order(first,{orderId:oid});
    assert.equal(o.duplicate,false);
    assert.equal(again.duplicate,true);
    await assert.rejects(()=>h.order(first,{orderId:oid,userId:ownerB}),/order_idempotency_conflict/);
    assert.equal(h.sqlite.prepare('SELECT COUNT(*) AS n FROM billing_orders').get().n,1);
  }finally{h.close()}
});
test('exact synthetic paid event grants only once; usage debit is idempotent and cannot overspend',async()=>{
  const h=setup();try{
    const quote=await h.q();
    const order=await h.order(quote);
    assert.equal((await getBillingWalletAudit(h.db,ownerA)).availableCredits,0);
    const ev={eventKey:next('PAY-EVENT'),orderId:order.orderId,eventType:'payment_verified',
      providerReference:'SYNTHETIC-PAYMENT-REF',amountIdr:Number(quote.lockedIdr),checkedAtMs:now+20000};
    h.bindRef(order.orderId,ev.providerReference);
    const pay=await recordSyntheticBillingEvent(h.db,ev);
    assert.equal(pay.status,'paid');
    assert.equal((await recordSyntheticBillingEvent(h.db,ev)).duplicate,true);
    assert.equal((await recordSyntheticBillingEvent(h.db,{...ev,eventKey:next('PAY-EVENT')})).duplicate,true);
    await assert.rejects(()=>recordSyntheticBillingEvent(h.db,{...ev,amountIdr:100}),/event_idempotency_conflict/);
    assert.equal(h.events().length,1);
    assert.equal(h.ledger().length,1);
    assert.equal((await getBillingWalletAudit(h.db,ownerA)).availableCredits,3000);
    await recordSyntheticUsageDebit(h.db,{userId:ownerA,requestId:'bill-usage-0001',credits:500,createdAtMs:now+30000});
    assert.equal((await recordSyntheticUsageDebit(h.db,{userId:ownerA,requestId:'bill-usage-0001',credits:500,createdAtMs:now+30000})).duplicate,true);
    await assert.rejects(()=>recordSyntheticUsageDebit(h.db,{userId:ownerA,requestId:'bill-usage-0001',credits:700,createdAtMs:now+30000}),/usage_idempotency_conflict/);
    await assert.rejects(()=>recordSyntheticUsageDebit(h.db,{userId:ownerA,requestId:'bill-usage-0002',credits:5000,createdAtMs:now+30000}),/billing_insufficient_or_frozen/);
    const wallet=await getBillingWalletAudit(h.db,ownerA);
    assert.equal(wallet.availableCredits,2500);assert.equal(wallet.debtCredits,0);assert.equal(wallet.reconciled,true);
    assert.equal(h.ledger().length,2);
  }finally{h.close()}
});
test('verified full refund after spend creates debt, blocks spend, and later grant repays debt',async()=>{
  const h=setup();try{
    const quote=await h.q(), order=await h.order(quote);
    const ref='SYNTHETIC-REFUNDABLE-REF';
    await h.pay(order.orderId,quote,{providerReference:ref});
    await recordSyntheticUsageDebit(h.db,{userId:ownerA,requestId:'bill-usage-0100',credits:2200,createdAtMs:now+30000});
    const refund={eventKey:next('REFUND-EVENT'),orderId:order.orderId,
      eventType:'refund_verified',providerReference:ref,amountIdr:Number(quote.lockedIdr),checkedAtMs:now+40000};
    assert.equal((await recordSyntheticBillingEvent(h.db,refund)).status,'refunded');
    assert.equal((await recordSyntheticBillingEvent(h.db,refund)).duplicate,true);
    const wallet=await getBillingWalletAudit(h.db,ownerA);
    assert.equal(wallet.availableCredits,0);assert.equal(wallet.debtCredits,2200);assert.equal(wallet.reconciled,true);
    assert.equal(wallet.spendingBlocked,true);
    await assert.rejects(()=>recordSyntheticUsageDebit(h.db,{userId:ownerA,requestId:'bill-usage-after-refund',credits:1,createdAtMs:now+50000}),/billing_insufficient_or_frozen/);
    const nextQuote=await h.q({sku:'pro',proposedCredits:15000,providerBudgetUsd:'1.50'});
    const nextOrder=await h.order(nextQuote);
    await h.pay(nextOrder.orderId,nextQuote);
    const after=await getBillingWalletAudit(h.db,ownerA);
    assert.equal(after.availableCredits,12800);
    assert.equal(after.debtCredits,0);
    assert.equal(after.netCredits,12800);
    assert.equal(after.reconciled,true);
    assert.equal(h.events().length,3);
    assert.equal(h.ledger().length,4); // grant, usage, full clawback, new grant
  }finally{h.close()}
});
test('chargeback makes credit reversal terminal and blocks a second refund',async()=>{
  const h=setup();try{
    const quote=await h.q(), order=await h.order(quote), reference='SYNTHETIC-CHARGEBACK-REF';
    await h.pay(order.orderId,quote,{providerReference:reference});
    const event={eventKey:next('CHARGEBACK'),orderId:order.orderId,
      eventType:'chargeback_verified',providerReference:reference,amountIdr:Number(quote.lockedIdr),checkedAtMs:now+30000};
    assert.equal((await recordSyntheticBillingEvent(h.db,event)).status,'chargeback');
    const wallet=await getBillingWalletAudit(h.db,ownerA);
    assert.equal(wallet.availableCredits,0);assert.equal(wallet.debtCredits,0);assert.equal(wallet.reconciled,true);
    await assert.rejects(()=>recordSyntheticBillingEvent(h.db,{...event,eventKey:next('REFUND-EVENT'),eventType:'refund_verified'}),/billing_event_order_amount_or_state_mismatch/);
    assert.throws(()=>h.sqlite.prepare("UPDATE billing_orders SET status='paid' WHERE id=?").run(order.orderId),/billing_unverified_or_invalid_transition/);
    assert.equal(h.ledger().length,2);
  }finally{h.close()}
});
test('events reject amount/reference replay, missing signed+status proof and unauthorized order transitions',async()=>{
  const h=setup();try{
    const q1=await h.q();const o1=await h.order(q1);
    const q2=await h.q();const o2=await h.order(q2);
    await assert.rejects(()=>h.pay(o1.orderId,q1,{amountIdr:1,providerReference:'SYNTH-UNIQUE-REF-1'}),/billing_event_order_amount_or_state_mismatch/);
    assert.throws(()=>h.sqlite.prepare("UPDATE billing_orders SET status='paid' WHERE id=?").run(o1.orderId),/billing_unverified_or_invalid_transition/);
    assert.throws(()=>h.sqlite.prepare("INSERT INTO billing_payment_events(event_key,order_id,event_type,provider_reference,amount_idr,signature_checked,status_checked,verification_mode,checked_at) VALUES(?,?,'payment_verified','REF-FAKE',?,0,1,'synthetic_test',?)").run(next('FORGED'),o1.orderId,Number(q1.lockedIdr),now+20000),/CHECK constraint failed/);
    await h.pay(o1.orderId,q1,{providerReference:'SYNTH-UNIQUE-REF-1'});
    await assert.rejects(()=>h.pay(o2.orderId,q2,{providerReference:'SYNTH-UNIQUE-REF-1'}),/UNIQUE constraint failed/);
    await assert.rejects(()=>recordSyntheticBillingEvent(h.db,{
      eventKey:next('REFUND'),orderId:o1.orderId,eventType:'refund_verified',providerReference:'WRONG',
      amountIdr:Number(q1.lockedIdr),checkedAtMs:now+30000
    }),/billing_event_order_amount_or_state_mismatch/);
    assert.throws(()=>h.sqlite.prepare("UPDATE billing_credit_ledger SET delta=99999 WHERE event_type='grant'").run(),/billing_ledger_append_only/);
    assert.throws(()=>h.sqlite.prepare("DELETE FROM billing_payment_events").run(),/billing_event_immutable/);
    assert.equal(h.ledger().length,1);
    assert.equal((await getBillingWalletAudit(h.db,ownerB)).availableCredits,0);
  }finally{h.close()}
});
test('failed credit ledger insert rolls back whole payment event/order status atomically',async()=>{
  const h=setup();try{
    const q=await h.q(),o=await h.order(q);
    h.sqlite.exec("CREATE TRIGGER billing_injected_failure BEFORE INSERT ON billing_credit_ledger WHEN NEW.event_type='grant' BEGIN SELECT RAISE(ABORT,'injected'); END");
    await assert.rejects(()=>h.pay(o.orderId,q),/injected/);
    assert.equal(h.row(o.orderId).status,'pending');
    assert.equal(h.events().length,0);
    assert.equal(h.ledger().length,0);
    assert.equal((await getBillingWalletAudit(h.db,ownerA)).availableCredits,0);
    h.sqlite.exec('DROP TRIGGER billing_injected_failure');
    await h.pay(o.orderId,q);
    assert.equal((await getBillingWalletAudit(h.db,ownerA)).availableCredits,3000);
  }finally{h.close()}
});
