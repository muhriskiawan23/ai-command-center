import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {sha256Hex} from '../src/http.js';
import {duitkuSignature} from '../src/duitku-sandbox-worker.js';
import {createDuitkuV2SandboxAdapter,validSandboxPaymentUrl} from '../src/duitku-v2-sandbox-contract.js';
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
    '../migrations/0014_billing_invoice_reference_guard.sql',
    '../migrations/0015_billing_sandbox_invoice_recovery.sql'
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
    // Recovery after rate expiry must never recompute the amount or re-issue.
    const afterExpiry=await h.start({
      quoteId,orderId,nowMs:now+700000,
      policyForSku:async()=>{throw new Error('server pricing was unexpectedly consulted');}
    });
    assert.equal(afterExpiry.amountIdr,first.amountIdr);
    assert.equal(afterExpiry.reference,first.reference);
    assert.equal(afterExpiry.duplicate,true);
    assert.equal(h.calls.filter(x=>x==='createInvoice').length,1);
    await assert.rejects(()=>h.start({quoteId,orderId,sessionToken:tokenB}),/order_idempotency_conflict/);
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
    await assert.rejects(()=>h.reverse(order,'refund_verified'),/conflicting_terminal_reversal/);
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

test('synthetic billing bridge cannot accidentally be reached through production or sandbox Worker entrypoints',()=>{
  const production=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const sandbox=readFileSync(new URL('../src/duitku-sandbox-worker.js',import.meta.url),'utf8');
  const config=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  assert.doesNotMatch(production,/billing-synthetic-gateway-bridge/);
  assert.doesNotMatch(sandbox,/billing-synthetic-gateway-bridge/);
  assert.doesNotMatch(config,/BILLING_CHECKOUT_ENABLED.*true/);
});

function v2MockTransport(options={}){
  const invoiceById=new Map(),requests=[];
  const faults={reply:null,invoiceReply:null,statusReply:null,statusCode:'00',...options};
  const fetcher=async(url, init)=>{
    assert.equal(init.method,'POST');
    assert.equal(init.redirect,'manual');
    assert.equal(init.headers['Content-Type'],'application/json');
    assert.equal(new URL(url).origin,'https://sandbox.duitku.com');
    assert.ok(init.signal);
    const input=JSON.parse(init.body);
    requests.push({endpoint:url.split('/').pop(),body:input});
    if(faults.reply)return faults.reply;
    if(url.endsWith('/v2/inquiry')){
      assert.equal(input.email,'bor-ai-sandbox@example.test');
      assert.equal(input.customerVaName,'BOR AI Sandbox');
      assert.equal(input.paymentMethod,'BT');
      assert.equal(input.signature,await duitkuSignature(key,merchantCode+input.merchantOrderId+input.paymentAmount));
      assert.match(input.callbackUrl,/^https:\/\/billing-sandbox\.example\.test\/api\/billing-sandbox\/callback$/);
      assert.equal(input.itemDetails[0].price,input.paymentAmount);
      const out={
        merchantCode,merchantOrderId:input.merchantOrderId,amount:String(input.paymentAmount),
        reference:'REF-'+input.merchantOrderId,statusCode:'00',
        paymentUrl:'https://sandbox.duitku.com/topup/topupdirectv2.aspx?ref=TEST'
      };
      invoiceById.set(input.merchantOrderId,out);
      return Response.json({...out,...faults.invoiceReply});
    }
    assert.ok(url.endsWith('/transactionStatus'));
    assert.equal(input.signature,await duitkuSignature(key,merchantCode+input.merchantOrderId));
    const existing=invoiceById.get(input.merchantOrderId);
    if(!existing)return Response.json({statusCode:'02',amount:'1'});
    return Response.json({
      merchantOrderId:existing.merchantOrderId,reference:existing.reference,
      amount:existing.amount,statusCode:faults.statusCode,
      ...faults.statusReply
    });
  };
  return {invoices:invoiceById,requests,faults,fetcher,
    adapter:createDuitkuV2SandboxAdapter({
      merchantCode,apiKey:key,publicBaseUrl:'https://billing-sandbox.example.test',
      fetcher
    })
  };
}
test('V2 adapter uses real documented raw response shape and persists sandbox link without issuing live payment',async()=>{
  const h=await harness();try{
    const m=v2MockTransport();
    const order=await h.start({provider:m.adapter});
    assert.equal(order.amountIdr,35821);
    assert.equal(order.paymentUrl,'https://sandbox.duitku.com/topup/topupdirectv2.aspx?ref=TEST');
    assert.equal(order.realCreditsGranted,false);
    assert.equal(m.requests.length,1);
    assert.equal(m.requests[0].endpoint,'inquiry');
    const stored=h.sqlite.prepare('SELECT sandbox_payment_url,provider_reference FROM billing_orders WHERE id=?').get(order.orderId);
    assert.equal(stored.sandbox_payment_url,order.paymentUrl);
    assert.equal(stored.provider_reference,order.reference);
    const again=await h.start({
      provider:m.adapter,quoteId:order.quoteId,orderId:order.orderId,
      nowMs:now+700000
    });
    assert.equal(again.paymentUrl,order.paymentUrl);
    assert.equal(again.amountIdr,order.amountIdr);
    assert.equal(again.duplicate,true);
    assert.equal(m.requests.length,1);
    assert.throws(()=>h.sqlite.prepare('UPDATE billing_orders SET sandbox_payment_url=? WHERE id=?')
      .run('https://sandbox.duitku.com/changed',order.orderId),/billing_sandbox_url_immutable/);
    const cb=await h.callback(order,{resultCode:'01'});
    assert.equal((await h.verify(cb,{provider:m.adapter})).status,'paid');
    assert.equal(m.requests.length,2);
    assert.equal(m.requests[1].endpoint,'transactionStatus');
    assert.equal((await h.wallet()).availableCredits,3000);
    assert.equal((await h.verify(cb,{provider:m.adapter})).duplicate,true);
    assert.equal(m.requests.length,2);
    assert.equal(h.count('billing_credit_ledger'),1);
    // A V2 transactionStatus is NOT proof of a monetary refund.
    await assert.rejects(()=>h.reverse(order,'refund_verified',{provider:m.adapter}),/sandbox_or_synthetic_gateway_only/);
  }finally{h.close()}
});
test('V2 status checks respect a 30-second backoff while pending; no grant until authoritative 00',async()=>{
  const h=await harness();try{
    const m=v2MockTransport({statusCode:'01'});
    const order=await h.start({provider:m.adapter});
    const callback=await h.callback(order);
    assert.equal((await h.verify(callback,{provider:m.adapter})).status,'pending');
    await assert.rejects(()=>h.verify(callback,{provider:m.adapter,nowMs:now+16000}),/sandbox_status_retry_later/);
    assert.equal(m.requests.length,2);
    assert.equal((await h.wallet()).availableCredits,0);
    m.faults.statusCode='00';
    const result=await h.verify(callback,{provider:m.adapter,nowMs:now+45000});
    assert.equal(result.status,'paid');
    assert.equal(h.count('billing_credit_ledger'),1);
    assert.equal((await h.wallet()).availableCredits,3000);
  }finally{h.close()}
});
test('V2 adapter rejects mismatched invoice, wrong status, redirects and insecure payment URLs',async()=>{
  const h=await harness();try{
    for(const patch of [
      {amount:'1'},{statusCode:'01'},{merchantCode:'D12345'},
      {reference:''},{paymentUrl:'https://sandbox.duitku.com.evil.test/pay'},
      {paymentUrl:'http://sandbox.duitku.com/pay'},
      {paymentUrl:'https://sandbox.duitku.com:443/pay#unsafe'}
    ]){
      const m=v2MockTransport({invoiceReply:patch});
      await assert.rejects(()=>h.start({provider:m.adapter}),/duitku_sandbox_invoice_mismatch/);
    }
    const redirect=v2MockTransport({reply:new Response(null,{status:302,headers:{Location:'https://attacker.test/'}})});
    await assert.rejects(()=>h.start({provider:redirect.adapter}),/duitku_sandbox_unavailable/);
    assert.equal(h.count('billing_credit_ledger'),0);
    assert.equal((await h.wallet()).availableCredits,0);
    assert.equal(validSandboxPaymentUrl('https://sandbox.duitku.com/pay'),true);
    assert.equal(validSandboxPaymentUrl('https://sandbox.duitku.com.evil.test/pay'),false);
    assert.throws(()=>createDuitkuV2SandboxAdapter({
      merchantCode:'D1234',apiKey:key,publicBaseUrl:'https://billing-sandbox.example.test',
      fetcher:()=>{}
    }),/invalid_merchant/);
    assert.throws(()=>createDuitkuV2SandboxAdapter({
      merchantCode,apiKey:key,publicBaseUrl:'http://billing-sandbox.example.test',
      fetcher:()=>{}
    }),/invalid_public_origin/);
    assert.throws(()=>createDuitkuV2SandboxAdapter({
      merchantCode,apiKey:key,publicBaseUrl:'https://billing-sandbox.example.test'
    }),/explicit_sandbox_fetcher_required/);
  }finally{h.close()}
});
test('V2 adapter returns no settlement if provider status has wrong order, reference or amount',async()=>{
  for(const tamper of [
    {amount:'999'}, {reference:'REF-WRONG'}, {merchantOrderId:'BORDER-wrong-11111'},
    {statusCode:'77'}
  ]){
    const h=await harness();try{
      const m=v2MockTransport({statusReply:tamper});
      const order=await h.start({provider:m.adapter});
      await assert.rejects(()=>h.verify(await h.callback(order),{provider:m.adapter}));
      assert.equal(h.count('billing_payment_events'),0);
      assert.equal((await h.wallet()).availableCredits,0);
    }finally{h.close()}
  }
});
