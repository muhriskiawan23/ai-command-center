import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../src/billing-staging-worker.js';
import { duitkuSignature } from '../src/duitku-sandbox-worker.js';

const origin='https://bor-ai-billing-staging.testacct.workers.dev';
const merchant='DS38217',secret='sandbox-test-only-key-not-a-real-secret';
const operatorToken='operator-test-only-credential-012345678901234567890123456789';
const csrfSecret='staging-csrf-test-only-secret-012345678901234567890123';
function stage(){
  const s=new DatabaseSync(':memory:');
  s.exec('PRAGMA foreign_keys=ON');
  for(const name of [
    '0001_staging_identity.sql','0002_billing_core.sql','0003_invoice_reference_guard.sql',
    '0004_invoice_recovery.sql','0005_daily_invoice_quota.sql','0006_callback_diagnostic_buckets.sql'
  ])s.exec(readFileSync(new URL('../staging/billing/migrations/'+name,import.meta.url),'utf8'));
  function stmt(query,args=[]){
    return {
      query,args,
      bind:(...values)=>stmt(query,values),
      first:async()=>s.prepare(query).get(...args)??null,
      all:async()=>({results:s.prepare(query).all(...args)}),
      run:async()=>({meta:{changes:Number(s.prepare(query).run(...args).changes)}})
    };
  }
  const db={
    prepare:q=>stmt(q),
    async batch(items){
      s.exec('BEGIN IMMEDIATE');
      try{
        const out=[];
        for(const {query,args} of items)out.push(s.prepare(query).run(...args));
        s.exec('COMMIT');return out;
      }catch(e){s.exec('ROLLBACK');throw e}
    }
  };
  const invoices=new Map(),requests=[];
  let mode='00',tamperStatus=null,tamperInvoice=null,offline=false;
  const mock=async(url,init)=>{
    assert.equal(new URL(url).origin,'https://sandbox.duitku.com');
    assert.equal(init.redirect,'manual');
    const input=JSON.parse(init.body);
    requests.push(url.split('/').pop());
    if(offline)throw new Error('provider offline');
    if(url.endsWith('/v2/inquiry')){
      assert.equal(input.merchantCode,merchant);
      assert.equal(input.paymentMethod,'BT');
      assert.equal(input.signature,await duitkuSignature(secret,merchant+input.merchantOrderId+input.paymentAmount));
      assert.equal(input.callbackUrl,origin+'/api/billing-sandbox/callback');
      assert.equal(input.returnUrl,origin+'/api/billing-sandbox/return');
      const invoice={
        merchantCode:merchant,merchantOrderId:input.merchantOrderId,
        amount:String(input.paymentAmount),reference:'STAGE-REF-'+input.merchantOrderId,
        statusCode:'00',paymentUrl:'https://sandbox.duitku.com/topup/topupdirectv2.aspx?ref=TEST'
      };
      invoices.set(invoice.merchantOrderId,invoice);
      return Response.json({...invoice,...tamperInvoice});
    }
    assert.ok(url.endsWith('/transactionStatus'));
    assert.equal(input.signature,await duitkuSignature(secret,merchant+input.merchantOrderId));
    return Response.json({...invoices.get(input.merchantOrderId),statusCode:mode,...tamperStatus});
  };
  const env={
    BILLING_DB:db,BILLING_STAGING_ENABLED:'true',BILLING_STAGING_ALLOW_TEST_INVOICES:'true',
    STAGING_D1_NAME:'bor-ai-billing-staging',STAGING_PUBLIC_ORIGIN:origin,
    DUITKU_SANDBOX_MERCHANT_CODE:merchant,DUITKU_SANDBOX_API_KEY:secret,
    BILLING_STAGING_OPERATOR_TOKEN:operatorToken,BILLING_STAGING_CSRF_SECRET:csrfSecret,
    DUITKU_SANDBOX_FETCHER:mock,
    STAGING_TEST_TARIFF_VERSION:'SANDBOX-UNAPPROVED',
    STAGING_TEST_BASIC_CREDITS:'3000',STAGING_TEST_PRO_CREDITS:'15000',
    STAGING_TEST_FX_IDR_PER_USD:'18000.25',STAGING_TEST_GATEWAY_FEE_IDR:'4000',
    STAGING_TEST_GATEWAY_FEE_TAX_IDR:'480',STAGING_TEST_PROVIDER_BUDGET_BASIC_USD:'0.30',
    STAGING_TEST_PROVIDER_BUDGET_PRO_USD:'1.50',STAGING_TEST_FX_RESERVE_IDR:'500',
    STAGING_TEST_REFUND_RESERVE_IDR:'700',STAGING_TEST_OTHER_COST_IDR:'1000',
    STAGING_TEST_MIN_CONTRIBUTION_BPS:'2000'
  };
  let requestsMade=0;
  const call=async(path,{method='GET',payload,form,cookie,csrf,token=operatorToken,headers={}}={})=>{
    const h=new Headers(headers);
    if(token!==null)h.set('Authorization','Bearer '+token);
    if(cookie)h.set('Cookie',cookie);
    if(csrf)h.set('X-BOR-Billing-CSRF',csrf);
    if(method==='POST' && cookie)h.set('Origin',origin);
    if(payload!==undefined)h.set('Content-Type','application/json');
    if(form!==undefined)h.set('Content-Type','application/x-www-form-urlencoded');
    const request=new Request(origin+path,{method,headers:h,
      body:payload!==undefined?JSON.stringify(payload):form!==undefined?new URLSearchParams(form).toString():undefined});
    requestsMade++;
    return worker.fetch(request,env);
  };
  const makeAccount=async()=>{
    const resp=await call('/api/billing-sandbox/operator/session',{method:'POST'});
    assert.equal(resp.status,201);
    const id=(await resp.json()).userId;
    const cookie=resp.headers.get('set-cookie').split(';')[0];
    const me=await call('/api/billing-sandbox/me',{cookie,token:null});
    assert.equal(me.status,200);
    return {id,cookie,csrf:(await me.json()).csrfToken};
  };
  const uuid=()=>crypto.randomUUID();
  const checkout=async(account,sku='basic',requestId=uuid(),extra={})=>{
    const resp=await call('/api/billing-sandbox/checkout',{
      method:'POST',cookie:account.cookie,csrf:account.csrf,token:null,payload:{sku,requestId,...extra}
    });
    return {response:resp,payload:await resp.json()};
  };
  const callback=async(invoice,changes={})=>{
    const amount=String(invoice.amountIdr);
    const fields={
      merchantCode:merchant,merchantOrderId:invoice.orderId,
      amount,reference:invoices.get(invoice.orderId).reference,
      resultCode:'00',signature:await duitkuSignature(secret,merchant+amount+invoice.orderId),...changes
    };
    return call('/api/billing-sandbox/callback',{method:'POST',form:fields,token:null});
  };
  const audit=async(orderId)=>call('/api/billing-sandbox/operator/audit?orderId='+orderId);
  const reconcile=async(orderId)=>call('/api/billing-sandbox/operator/reconcile',{
    method:'POST',payload:{orderId}
  });
  return {s,env,db,requests,call,makeAccount,checkout,callback,audit,reconcile,
    setMode:v=>{mode=v},setTamperStatus:v=>{tamperStatus=v},setTamperInvoice:v=>{tamperInvoice=v},
    offline:v=>{offline=v},uuid,requestsMade:()=>requestsMade,close:()=>s.close()};
}
test('staging is disabled until explicit operator flags and secrets are configured',async()=>{
  const h=stage();try{
    h.env.BILLING_STAGING_ENABLED='false';
    const health=await h.call('/health');
    assert.equal(health.status,200);
    assert.equal((await health.json()).configured,false);
    assert.equal((await h.call('/api/billing-sandbox/operator/session',{method:'POST'})).status,503);
    h.env.BILLING_STAGING_ENABLED='true';h.env.STAGING_D1_NAME='bor-ai-chat';
    assert.equal((await h.call('/api/billing-sandbox/operator/session',{method:'POST'})).status,503);
  }finally{h.close()}
});
test('operator-issued staging account session has Secure HttpOnly SameSite cookie and account-only CSRF',async()=>{
  const h=stage();try{
    assert.equal((await h.call('/api/billing-sandbox/operator/session',{method:'POST',token:'invalid'})).status,401);
    const resp=await h.call('/api/billing-sandbox/operator/session',{method:'POST'});
    assert.equal(resp.status,201);
    const c=resp.headers.get('set-cookie');
    assert.match(c,/^__Host-bor_billing_stage=/);
    for(const value of ['Secure','HttpOnly','SameSite=Strict','Path=/'])assert.ok(c.includes(value));
    assert.equal((await resp.json()).realCreditsGranted,false);
    const a=await h.makeAccount();
    const missing=await h.call('/api/billing-sandbox/checkout',{method:'POST',cookie:a.cookie,token:null,payload:{sku:'basic',requestId:h.uuid()}});
    assert.equal(missing.status,403);
    assert.equal((await missing.json()).error,'csrf_mismatch');
    const notAuthenticated=await h.call('/api/billing-sandbox/me',{token:null});
    assert.equal(notAuthenticated.status,401);
  }finally{h.close()}
});
test('Basic/Pro staging checkout binds IDR quote and provider reference to one test account',async()=>{
  const h=stage();try{
    const a=await h.makeAccount(),b=await h.makeAccount();
    const order=await h.checkout(a);
    assert.equal(order.response.status,201);
    assert.equal(order.payload.amountIdr,35821);
    assert.equal(order.payload.realCreditsGranted,false);
    assert.match(order.payload.paymentUrl,/^https:\/\/sandbox\.duitku\.com\//);
    assert.equal(h.requests.filter(x=>x==='inquiry').length,1);
    const stored=h.s.prepare('SELECT q.price_usd_micro,q.quoted_idr,o.provider_reference FROM billing_quotes q JOIN billing_orders o ON o.quote_id=q.id WHERE o.id=?')
      .get(order.payload.orderId);
    assert.equal(stored.price_usd_micro,1990000);
    assert.equal(stored.quoted_idr,35821);
    assert.match(stored.provider_reference,/^STAGE-REF-/);
    const wrong=await h.call('/api/billing-sandbox/orders/'+order.payload.orderId,{cookie:b.cookie,token:null});
    assert.equal(wrong.status,404);
    const own=await h.call('/api/billing-sandbox/orders/'+order.payload.orderId,{cookie:a.cookie,token:null});
    assert.equal((await own.json()).amountIdr,35821);
    const pro=await h.checkout(a,'pro');
    assert.equal(pro.payload.amountIdr,125822);
    const view=await h.audit(pro.payload.orderId);
    assert.equal(view.status,200);assert.equal((await view.json()).ledgerEntries,0);
  }finally{h.close()}
});
test('same request id retains original quote, invoice and URL and does not call Duitku twice',async()=>{
  const h=stage();try{
    const a=await h.makeAccount(),requestId=h.uuid();
    const first=await h.checkout(a,'basic',requestId);
    const second=await h.checkout(a,'basic',requestId);
    assert.equal(second.response.status,200);
    assert.equal(second.payload.duplicate,true);
    assert.equal(second.payload.orderId,first.payload.orderId);
    assert.equal(second.payload.amountIdr,first.payload.amountIdr);
    assert.equal(second.payload.paymentUrl,first.payload.paymentUrl);
    assert.equal(h.requests.filter(x=>x==='inquiry').length,1);
  }finally{h.close()}
});
test('staging callback diagnostics require operator auth, never reveal payment identifiers, and count honest outcomes',async()=>{
  const h=stage();try{
    const path='/api/billing-sandbox/operator/callback-diagnostics';
    assert.equal((await h.call(path,{token:null})).status,401);
    assert.equal((await h.call(path,{token:'wrong'})).status,401);
    assert.equal((await h.call(path+'?hours=169')).status,400);
    assert.equal((await h.call(path+'?hours=24&extra=x')).status,400);
    assert.equal((await h.call(path,{method:'POST'})).status,405);
    const before=await (await h.call(path)).json();
    assert.deepEqual(before.summary,[]);
    assert.deepEqual(before.recent,[]);
    const a=await h.makeAccount(),invoice=(await h.checkout(a)).payload;
    const forged=await h.call('/api/billing-sandbox/callback',{
      method:'POST',form:{probe:'UNTRUSTED_CANARY_DO_NOT_LOG'},token:null
    });
    assert.equal(forged.status,400);
    h.setMode('01');
    const pending=await h.callback(invoice);
    assert.equal(pending.status,503);
    h.s.prepare('UPDATE billing_orders SET sandbox_status_check_after=0 WHERE id=?').run(invoice.orderId);
    h.setMode('00');
    assert.equal((await h.callback(invoice)).status,200);
    assert.equal((await h.callback(invoice)).status,200);
    const diagnostics=await (await h.call(path+'?hours=24')).json();
    assert.equal(diagnostics.sandbox,true);
    assert.equal(diagnostics.isolatedBilling,true);
    assert.equal(diagnostics.realCreditsGranted,false);
    assert.equal(diagnostics.payloadsStored,false);
    assert.deepEqual(diagnostics.summary.map(x=>[x.disposition,x.category,x.hits]).sort(),[
      ['accepted','paid_duplicate',1],
      ['accepted','paid_verified',1],
      ['rejected','callback_missing_required_field',1],
      ['retry','provider_pending',1]
    ].sort());
    assert.ok(diagnostics.recent.length>=3);
    assert.doesNotMatch(JSON.stringify(diagnostics),/BSTAGE-|STAGE-REF-|UNTRUSTED_CANARY|DS38217|sandbox-test-only-key/);
    const audit=await (await h.audit(invoice.orderId)).json();
    assert.equal(audit.ledgerEntries,1);
    assert.equal(audit.ledgerCredits,3000);
    assert.equal(audit.realCreditsGranted,false);
  }finally{h.close()}
});
test('diagnostic storage outage never changes callback signature, status or one-credit-grant behavior',async()=>{
  const h=stage();const original=console.warn;const logs=[];
  console.warn=(...args)=>logs.push(args);
  try{
    const a=await h.makeAccount(),invoice=(await h.checkout(a)).payload;
    h.s.exec('DROP TABLE staging_callback_diagnostic_buckets');
    assert.equal((await h.callback(invoice)).status,200);
    assert.equal((await h.callback(invoice)).status,200);
    const audit=await (await h.audit(invoice.orderId)).json();
    assert.equal(audit.ledgerEntries,1);
    assert.equal(audit.ledgerCredits,3000);
    assert.ok(logs.some(x=>x[0]==='bor_billing_staging_diagnostic_store_unavailable'));
  }finally{console.warn=original;h.close()}
});
test('signed successful callback is checked against V2 transactionStatus and creates exactly one test grant',async()=>{
  const h=stage();try{
    const a=await h.makeAccount(),b=await h.makeAccount(),invoice=(await h.checkout(a)).payload;
    h.setMode('01');
    const waiting=await h.callback(invoice);
    assert.equal(waiting.status,503);
    assert.equal((await h.audit(invoice.orderId)).status,200);
    assert.equal((await (await h.audit(invoice.orderId)).json()).ledgerEntries,0);
    h.s.prepare('UPDATE billing_orders SET sandbox_status_check_after=0 WHERE id=?').run(invoice.orderId);
    h.setMode('00');
    const callback=await h.callback(invoice);
    assert.equal(callback.status,200);
    assert.equal((await callback.json()).received,true);
    const again=await h.callback(invoice);
    assert.equal(again.status,200);
    const aud=await (await h.audit(invoice.orderId)).json();
    assert.equal(aud.ledgerEntries,1);
    assert.equal(aud.ledgerCredits,3000);
    assert.equal(aud.walletReconciled,true);
    const ownerA=await (await h.call('/api/billing-sandbox/me',{cookie:a.cookie,token:null})).json();
    const ownerB=await (await h.call('/api/billing-sandbox/me',{cookie:b.cookie,token:null})).json();
    assert.equal(ownerA.availableTestCredits,3000);
    assert.equal(ownerB.availableTestCredits,0);
    assert.equal(h.requests.filter(x=>x==='transactionStatus').length,2);
  }finally{h.close()}
});
test('documented Duitku callback metadata is accepted but never treated as payment proof',async()=>{
  const h=stage();try{
    const a=await h.makeAccount(),invoice=(await h.checkout(a)).payload;
    h.setMode('01');
    const pending=await h.callback(invoice,{
      productDetail:'BOR AI test',paymentCode:'BT',
      publisherOrderId:'SYNTHETIC-PUBLISHER-ID',settlementDate:'2026-11-19'
    });
    assert.equal(pending.status,503);
    assert.equal((await (await h.audit(invoice.orderId)).json()).ledgerEntries,0);
    h.s.prepare('UPDATE billing_orders SET sandbox_status_check_after=0 WHERE id=?').run(invoice.orderId);
    h.setMode('00');
    const settled=await h.callback(invoice,{
      productDetail:'BOR AI test',paymentCode:'BT',
      publisherOrderId:'SYNTHETIC-PUBLISHER-ID',settlementDate:'2026-11-19'
    });
    assert.equal(settled.status,200);
    assert.equal((await (await h.audit(invoice.orderId)).json()).ledgerEntries,1);
  }finally{h.close()}
});
test('forged callbacks, mismatched provider data, and missing auth never credit a staging wallet',async()=>{
  const h=stage();try{
    const a=await h.makeAccount(),invoice=(await h.checkout(a)).payload;
    const forged=await h.callback(invoice,{signature:'0'.repeat(64)});
    assert.equal(forged.status,403);
    assert.equal((await (await h.audit(invoice.orderId)).json()).ledgerEntries,0);
    h.setTamperStatus({amount:'300'});
    const bad=await h.callback(invoice);
    assert.equal(bad.status,503);
    assert.equal((await (await h.audit(invoice.orderId)).json()).ledgerEntries,0);
    const own=await h.call('/api/billing-sandbox/orders/'+invoice.orderId,{token:null});
    assert.equal(own.status,401);
    assert.equal(h.requests.filter(x=>x==='transactionStatus').length,1);
  }finally{h.close()}
});
test('extra Duitku callback metadata is ignored; server status still controls grants',async()=>{
  const h=stage();
  const original=console.warn,events=[];
  console.warn=(...args)=>events.push(args);
  try{
    const a=await h.makeAccount(),order=(await h.checkout(a)).payload;
    h.setMode('01');
    const waiting=await h.callback(order,{newDuitkuMetadata:'SECRET_CALLBACK_CANARY_98563'});
    assert.equal(waiting.status,503);
    assert.equal((await (await h.audit(order.orderId)).json()).ledgerEntries,0);
    h.s.prepare('UPDATE billing_orders SET sandbox_status_check_after=0 WHERE id=?').run(order.orderId);
    h.setMode('00');
    const settled=await h.callback(order,{newDuitkuMetadata:'SECRET_CALLBACK_CANARY_98563'});
    assert.equal(settled.status,200);
    assert.equal((await (await h.audit(order.orderId)).json()).ledgerEntries,1);
    assert.doesNotMatch(JSON.stringify(events),/SECRET_CALLBACK_CANARY_98563|BSTAGE-|STAGE-REF-/);
  }finally{console.warn=original;h.close()}
});
test('missing and duplicate mandatory callback keys are rejected with safe categories',async()=>{
  const h=stage();
  const original=console.warn,events=[];
  console.warn=(...args)=>events.push(args);
  try{
    const a=await h.makeAccount(),order=(await h.checkout(a)).payload;
    const fields=new URLSearchParams({
      merchantCode:merchant,amount:String(order.amountIdr),
      merchantOrderId:order.orderId,reference:'SECRET_TEST_REFERENCE',
      resultCode:'00',signature:'0'.repeat(64),extra:'SECRET_CANARY_NOT_LOGGED'
    });
    fields.delete('resultCode');
    const missing=await h.call('/api/billing-sandbox/callback',{method:'POST',form:fields,token:null});
    assert.equal(missing.status,400);
    assert.equal(events.at(-1)?.[1]?.category,'callback_missing_required_field');
    fields.append('resultCode','00');
    fields.append('amount',String(order.amountIdr));
    const duplicated=await h.call('/api/billing-sandbox/callback',{method:'POST',form:fields,token:null});
    assert.equal(duplicated.status,400);
    assert.equal(events.at(-1)?.[1]?.category,'callback_duplicate_field');
    assert.doesNotMatch(JSON.stringify(events),/SECRET_CANARY_NOT_LOGGED|SECRET_TEST_REFERENCE|BSTAGE-/);
    assert.equal((await (await h.audit(order.orderId)).json()).ledgerEntries,0);
  }finally{console.warn=original;h.close()}
});
test('lost callback can be reconciled only with operator authorization, using actual sandbox status',async()=>{
  const h=stage();try{
    const a=await h.makeAccount(),invoice=(await h.checkout(a)).payload;
    const forbidden=await h.call('/api/billing-sandbox/operator/reconcile',{
      method:'POST',token:'invalid',payload:{orderId:invoice.orderId}
    });
    assert.equal(forbidden.status,401);
    assert.equal((await h.reconcile(invoice.orderId)).status,200);
    const detail=await (await h.audit(invoice.orderId)).json();
    assert.equal(detail.ledgerEntries,1);
    assert.equal(detail.ledgerCredits,3000);
    assert.equal((await h.reconcile(invoice.orderId)).status,200);
    assert.equal(h.requests.filter(x=>x==='transactionStatus').length,1);
  }finally{h.close()}
});
test('invoice failure never creates duplicate invoice and leaves credit balance zero',async()=>{
  const h=stage();try{
    const a=await h.makeAccount();h.offline(true);
    const requestId=h.uuid();
    const result=await h.checkout(a,'basic',requestId);
    assert.equal(result.response.status,502);
    h.offline(false);
    const again=await h.checkout(a,'basic',requestId);
    assert.equal(again.payload.status,'invoice_creation_unknown');
    assert.equal(h.requests.filter(x=>x==='inquiry').length,1);
    assert.equal((await (await h.call('/api/billing-sandbox/me',{cookie:a.cookie,token:null})).json()).availableTestCredits,0);
  }finally{h.close()}
});
test('staging hard caps stop >3 daily invoices per account, no real customer accounts',async()=>{
  const h=stage();try{
    const a=await h.makeAccount();
    for(let i=0;i<3;i++)assert.equal((await h.checkout(a)).response.status,201);
    const limit=await h.checkout(a);
    assert.equal(limit.response.status,429);
    assert.equal((await limit.response.json().catch(()=>({}))).error,undefined);
    assert.equal(h.requests.filter(x=>x==='inquiry').length,3);
  }finally{h.close()}
});
test('no staging Worker entrypoint or isolated D1 binding is referenced by production Worker',()=>{
  const prod=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const conf=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  assert.doesNotMatch(prod,/billing-staging-worker/);
  assert.doesNotMatch(conf,/bor-ai-billing-staging|BILLING_DB/);
});
