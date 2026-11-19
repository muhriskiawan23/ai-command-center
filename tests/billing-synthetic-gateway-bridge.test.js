import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {sha256Hex} from '../src/http.js';
import {duitkuSignature} from '../src/duitku-sandbox-worker.js';
import {recordSyntheticUsageDebit,getBillingWalletAudit} from '../src/billing-ledger-foundation.js';
import {
  SYNTHETIC_GATEWAY_BRIDGE_MODE,resolveOfflineBillingSession,
  startOfflineDuitkuCheckout,verifyOfflineDuitkuCallback,readOfflineCustomerOrder,
  reconcileOfflineProviderReversal
} from '../src/billing-synthetic-gateway-bridge.js';

const now=Date.UTC(2026,10,19,8,0,0);
const merchantCode='DS38217';
const key='test-only-merchant-hmac-key-not-a-secret';
const adminToken='operator-fixture-logged-in-authorization';
const tokenA='session-A-not-a-real-login-cookie-token-00001';
const tokenB='session-B-not-a-real-login-cookie-token-00002';
const ownerA='synthetic-google-account-A';
const ownerB='synthetic-google-account-B';
let nextId=0;
const uid=k=>k+'-'+String(++nextId).padStart(12,'0');
async function harness(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for(const p of [
    '../migrations/0001_auth_and_chat.sql',
    '../migrations/0013_billing_foundation.sql',
    '../migrations/0014_billing_invoice_reference_guard.sql'
  ])sqlite.exec(readFileSync(new URL(p,import.meta.url),'utf8'));
  for(const [user,token] of [[ownerA,tokenA],[ownerB,tokenB]]){
    sqlite.prepare('INSERT INTO users(id,email,created_at,updated_at) VALUES(?,?,?,?)')
      .run(user,user+'@example.test',now,now);
    sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .run(await sha256Hex(token),user,Math.floor((now+900000)/1000),now);
  }
  const stm=(sql,values=[])=>({
    bind:(...args)=>stm(sql,args),
    first:async()=>sqlite.prepare(sql).get(...values)??null,
    run:async()=>({meta:{changes:Number(sqlite.prepare(sql).run(...values).changes)}})
  });
  const db={prepare:sql=>stm(sql)};
  const invoices=new Map(),calls=[];
  const control={statusCode:'00',reversalStatus:'refunded',tamperInvoice:null,tamperStatus:null,tamperReversal:null,failCreate:false};
  const provider={
    syntheticGatewayForTestsOnly:true,
    async createInvoice(input){
      calls.push('createInvoice');
      if(control.failCreate)throw new Error('simulated ambiguous timeout');
      const invoice={
        merchantCode:input.merchantCode,merchantOrderId:input.merchantOrderId,
        amount:input.amount,reference:'REF-'+input.merchantOrderId,statusCode:'00'
      };
      invoices.set(input.merchantOrderId,invoice);
      return {...invoice,...control.tamperInvoice};
    },
    async checkStatus({merchantOrderId}){
      calls.push('checkStatus');
      const invoice=invoices.get(merchantOrderId);
      if(!invoice)throw new Error('provider does not know invoice');
      return {...invoice,currency:'IDR',statusCode:control.statusCode,...control.tamperStatus};
    },
    async checkReversal({merchantOrderId,eventType}){
      calls.push('checkReversal');
      const invoice=invoices.get(merchantOrderId);
      if(!invoice)throw new Error('provider does not know invoice');
      return {
        ...invoice,currency:'IDR',status:control.reversalStatus,
        reversalId:'REV-'+eventType+'-'+merchantOrderId,...control.tamperReversal
      };
    }
  };
  const policyForSku=async(sku,time)=>{
    const tier=sku==='pro'
      ? {proposedCredits:15000,providerBudgetUsd:'1.50'}
      : sku==='topup'
        ? {topupPriceUsd:'1.50',proposedCredits:1000,providerBudgetUsd:'0.10'}
        : {proposedCredits:3000,providerBudgetUsd:'0.30'};
    return {
      sku,...tier,proposedTariffVersion:'synthetic-allowance-not-approved',
      fxIdrPerUsd:'18000.25',fxSource:'synthetic-FX-not-live',
      issuedAtMs:time,expiresAtMs:time+600000,
      gatewayMethod:'BT',gatewayFeeIdr:4000,gatewayFeeSource:'synthetic-unverified-fee',
      gatewayFeeTaxIdr:480,fxReserveIdr:500,refundReserveIdr:700,
      otherVariableCostsIdr:1000,minimumContributionBps:2000
    };
  };
  const start=(overrides={})=>startOfflineDuitkuCheckout({
    db,sessionToken:tokenA,sku:'basic',quoteId:uid('BQUOTE'),orderId:uid('BORDER'),
    nowMs:now,provider,merchantCode,policyForSku,...overrides
  });
  const callback=async(invoice,overrides={})=>{
    const fields={
      merchantCode,amount:String(invoice.amountIdr),merchantOrderId:invoice.orderId,
      reference:invoice.reference,resultCode:'00',
      signature:await duitkuSignature(key,merchantCode+invoice.amountIdr+invoice.orderId),
      ...overrides
    };
    return new URLSearchParams(fields);
  };
  const verify=(body,overrides={})=>verifyOfflineDuitkuCallback({
    db,callback:body,provider,merchantCode,apiKey:key,nowMs:now+15000,...overrides
  });
  const reverse=(invoice,eventType='refund_verified',overrides={})=>reconcileOfflineProviderReversal({
    db,operatorToken:adminToken,authorizeOperator:async(token)=>token===adminToken,
    provider,orderId:invoice.orderId,eventType,nowMs:now+60000,...overrides
  });
  const wallet=(user=ownerA)=>getBillingWalletAudit(db,user);
  const count=(table)=>sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
  return {sqlite,db,provider,control,calls,invoices,policyForSku,start,callback,verify,reverse,wallet,count,
    close:()=>sqlite.close()};
}

test('uses existing SHA256 session token and rejects missing, expired and forged account claims',async()=>{
  const h=await harness();try{
    assert.equal(SYNTHETIC_GATEWAY_BRIDGE_MODE,'offline_no_real_payments_or_entitlements');
    assert.equal(await resolveOfflineBillingSession(h.db,{sessionToken:tokenA,nowMs:now}),ownerA);
    await assert.rejects(()=>resolveOfflineBillingSession(h.db,{sessionToken:ownerA,nowMs:now}),/authentication_required/);
    await assert.rejects(()=>resolveOfflineBillingSession(h.db,{sessionToken:tokenA,nowMs:now+900000}),/authentication_required/);
    await assert.rejects(()=>h.start({sessionToken:'stolen-cookie-not-a-valid-token-00000'}),/authentication_required/);
    assert.equal(h.count('billing_orders'),0);
  }finally{h.close()}
});
test('customer checkout uses fixed server pricing and a locked owner-bound FX quote',async()=>{
  const h=await harness();try{
    const order=await h.start();
    assert.equal(order.amountIdr,35821);
    assert.equal(order.status,'pending');
    assert.equal(order.synthetic,true);
    assert.equal(order.realCreditsGranted,false);
    assert.equal(order.checkoutEnabled,false);
    assert.equal(h.count('billing_orders'),1);
    const stored=h.sqlite.prepare('SELECT * FROM billing_orders WHERE id=?').get(order.orderId);
    assert.equal(stored.provider_reference,order.reference);
    const quote=h.sqlite.prepare('SELECT * FROM billing_quotes WHERE id=?').get(order.quoteId);
    assert.equal(quote.price_usd_micro,1990000);
    assert.equal(quote.quoted_idr,35821);
    assert.throws(()=>h.sqlite.prepare('UPDATE billing_quotes SET quoted_idr=9 WHERE id=?').run(order.quoteId),/billing_quote_immutable/);
    await assert.rejects(()=>readOfflineCustomerOrder({db:h.db,sessionToken:tokenB,orderId:order.orderId,nowMs:now}),/order_not_found/);
    const own=await readOfflineCustomerOrder({db:h.db,sessionToken:tokenA,orderId:order.orderId,nowMs:now});
    assert.equal(own.status,'pending');assert.equal(own.availableCredits,0);
    assert.equal((await h.start({sku:'pro'})).amountIdr,125822);
    assert.equal((await h.start({sku:'topup'})).amountIdr,27001);
    assert.equal(h.calls.filter(x=>x==='createInvoice').length,3);
  }finally{h.close()}
});
test('invoice replay never calls mock provider twice and ambiguous creation fails closed',async()=>{
  const h=await harness();try{
    const quoteId=uid('BQUOTE'),orderId=uid('BORDER');
    const first=await h.start({quoteId,orderId});
    const replay=await h.start({quoteId,orderId});
    assert.equal(replay.duplicate,true);
    assert.equal(replay.reference,first.reference);
    assert.equal(h.calls.filter(x=>x==='createInvoice').length,1);
    await assert.rejects(()=>h.start({quoteId,orderId,sessionToken:tokenB}),/quote_idempotency_conflict/);
    h.control.failCreate=true;
    const unknownQuoteId=uid('BQUOTE'),unknownOrderId=uid('BORDER');
    await assert.rejects(()=>h.start({quoteId:unknownQuoteId,orderId:unknownOrderId}),/ambiguous timeout/);
    const unknown=await h.start({quoteId:unknownQuoteId,orderId:unknownOrderId});
    assert.equal(unknown.status,'invoice_creation_unknown');
    assert.equal(unknown.reference,null);
    assert.equal(h.calls.filter(x=>x==='createInvoice').length,2);
    assert.equal((await h.wallet()).availableCredits,0);
  }finally{h.close()}
});
test('missing invoice binding is never allowed to grant credits',async()=>{
  const h=await harness();try{
    h.control.failCreate=true;
    const orderId=uid('BORDER');
    await assert.rejects(()=>h.start({orderId}),/ambiguous timeout/);
    assert.throws(()=>h.sqlite.prepare("INSERT INTO billing_payment_events(event_key,order_id,event_type,provider_reference,amount_idr,signature_checked,status_checked,verification_mode,checked_at) VALUES(? ,?, 'payment_verified','FAKE_REF',35821,1,1,'synthetic_test',?)")
      .run(uid('EVENT'),orderId,now+15000),/billing_unbound_invoice_reference/);
    assert.equal(h.count('billing_credit_ledger'),0);
  }finally{h.close()}
});
test('signed callback still needs authoritative provider confirmation and exact IDR amount',async()=>{
  const h=await harness();try{
    const order=await h.start();
    const body=await h.callback(order);
    h.control.statusCode='01';
    assert.equal((await h.verify(body)).status,'pending');
    assert.equal((await h.wallet()).availableCredits,0);
    h.control.statusCode='02';
    assert.equal((await h.verify(body)).status,'provider_failed');
    assert.equal(h.count('billing_payment_events'),0);
    h.control.statusCode='00';
    h.control.tamperStatus={amount:'999'};
    await assert.rejects(()=>h.verify(body),/provider_status_mismatch/);
    h.control.tamperStatus={merchantOrderId:'BORDER-wrong-00001'};
    await assert.rejects(()=>h.verify(body),/provider_status_mismatch/);
    h.control.tamperStatus={reference:'DIFFERENT'};
    await assert.rejects(()=>h.verify(body),/provider_status_mismatch/);
    h.control.tamperStatus={currency:'USD'};
    await assert.rejects(()=>h.verify(body),/provider_status_mismatch/);
    h.control.tamperStatus=null;
    assert.equal((await h.verify(await h.callback(order,{resultCode:'01'}))).status,'paid');
    assert.equal((await h.wallet()).availableCredits,3000);
    assert.equal(h.count('billing_payment_events'),1);
  }finally{h.close()}
});
test('forged callback, tampering, extra fields and parameter duplication never grant credits',async()=>{
  const h=await harness();try{
    const order=await h.start(),body=await h.callback(order);
    const bad=[
      await h.callback(order,{signature:'0'.repeat(64)}),
      await h.callback(order,{amount:'10000'}),
      await h.callback(order,{reference:'ATTACK'}),
      await h.callback(order,{merchantCode:'D12345'}),
      await h.callback(order,{merchantOrderId:'BORDER-attacker-001'}),
      await h.callback(order,{resultCode:'99'})
    ];
    const duplicate=await h.callback(order);
    duplicate.append('amount',String(order.amountIdr));bad.push(duplicate);
    const extras=await h.callback(order);extras.append('unexpected','x');bad.push(extras);
    for(const b of bad)await assert.rejects(()=>h.verify(b));
    assert.equal(h.calls.filter(x=>x==='checkStatus').length,0);
    assert.equal((await h.wallet()).availableCredits,0);
  }finally{h.close()}
});
test('multiple simultaneous and replayed signed callbacks grant exactly once',async()=>{
  const h=await harness();try{
    const order=await h.start();
    const body=await h.callback(order);
    const callbacks=await Promise.all(Array.from({length:12},()=>h.verify(body)));
    assert.ok(callbacks.every(x=>x.status==='paid'));
    assert.ok(callbacks.some(x=>x.duplicate));
    assert.equal((await h.wallet()).availableCredits,3000);
    assert.equal(h.count('billing_payment_events'),1);
    assert.equal(h.count('billing_credit_ledger'),1);
    assert.equal((await h.verify(body,{nowMs:now+45000})).duplicate,true);
    assert.equal(h.count('billing_credit_ledger'),1);
  }finally{h.close()}
});
test('refund after spent credits requires operator plus independently confirmed full reversal',async()=>{
  const h=await harness();try{
    const order=await h.start(),body=await h.callback(order);
    await h.verify(body);
    await recordSyntheticUsageDebit(h.db,{userId:ownerA,requestId:'BILL-usage-request-00001',credits:2200,createdAtMs:now+22000});
    const attempted=()=>h.reverse(order,'refund_verified',{operatorToken:'bad-operator-token'});
    const callsBefore=h.calls.length;
    await assert.rejects(attempted,/operator_authorization_required/);
    assert.equal(h.calls.length,callsBefore);
    h.control.reversalStatus='pending';
    await assert.rejects(()=>h.reverse(order),/unverified_or_partial_reversal/);
    h.control.reversalStatus='refunded';
    h.control.tamperReversal={amount:'1'};
    await assert.rejects(()=>h.reverse(order),/unverified_or_partial_reversal/);
    h.control.tamperReversal={reference:'OTHER'};
    await assert.rejects(()=>h.reverse(order),/unverified_or_partial_reversal/);
    h.control.tamperReversal=null;
    const reversal=await h.reverse(order);
    assert.equal(reversal.status,'refunded');
    assert.equal(reversal.debtCredits,2200);
    assert.equal(reversal.availableCredits,0);
    assert.equal(reversal.moneyRefundExecuted,false);
    assert.equal((await h.reverse(order)).duplicate,true);
    await assert.rejects(()=>recordSyntheticUsageDebit(h.db,{userId:ownerA,requestId:'BILL-usage-frozen-00001',credits:1,createdAtMs:now+70000}),/billing_insufficient_or_frozen/);
    assert.equal(h.count('billing_credit_ledger'),3);
    assert.equal((await h.wallet()).reconciled,true);
    assert.equal((await h.verify(body)).status,'refunded'); // paid callback cannot reopen refunded order
    const order2=await h.start({sku:'pro',nowMs:now+75000});
    await h.verify(await h.callback(order2),{nowMs:now+80000});
    const wallet=await h.wallet();
    assert.equal(wallet.availableCredits,12800);
    assert.equal(wallet.debtCredits,0);
    assert.equal(wallet.reconciled,true);
  }finally{h.close()}
});
test('chargeback and refund paths are mutually exclusive and preserve complete audit history',async()=>{
  const h=await harness();try{
    const order=await h.start(),body=await h.callback(order);
    await h.verify(body);
    h.control.reversalStatus='chargeback';
    assert.equal((await h.reverse(order,'chargeback_verified')).status,'chargeback');
    assert.equal((await h.wallet()).availableCredits,0);
    assert.equal((await h.reverse(order,'refund_verified')).status,'chargeback');
    assert.equal(h.count('billing_credit_ledger'),2);
    assert.equal(h.count('billing_payment_events'),2);
    assert.throws(()=>h.sqlite.prepare('DELETE FROM billing_credit_ledger').run(),/billing_ledger_append_only/);
  }finally{h.close()}
});
test('ledger insertion failure rolls back synthetic payment settlement and is recoverable',async()=>{
  const h=await harness();try{
    const order=await h.start(),body=await h.callback(order);
    h.sqlite.exec("CREATE TRIGGER injected_payment_error BEFORE INSERT ON billing_credit_ledger BEGIN SELECT RAISE(ABORT,'synthetic-injected-ledger-failure'); END");
    await assert.rejects(()=>h.verify(body),/synthetic-injected-ledger-failure/);
    assert.equal(h.count('billing_payment_events'),0);
    assert.equal(h.sqlite.prepare('SELECT status FROM billing_orders WHERE id=?').get(order.orderId).status,'pending');
    h.sqlite.exec('DROP TRIGGER injected_payment_error');
    assert.equal((await h.verify(body)).status,'paid');
    assert.equal((await h.wallet()).availableCredits,3000);
  }finally{h.close()}
});
