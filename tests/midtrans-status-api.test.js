import test from "node:test";
import assert from "node:assert/strict";
import { checkMidtransSandboxOrder } from "../src/midtrans-status-api.js";
const order={orderId:"bor-123",amountIdr:36254,currency:"IDR",environment:"sandbox"};
const key="SB-Mid-server-FAKE-TEST-KEY";
const status={status_code:"200",order_id:"bor-123",gross_amount:"36254.00",currency:"IDR",transaction_status:"settlement",transaction_id:"tx-123",merchant_id:"M123"};
const fake=(payload,code=200)=>async(url,opts)=>{
 assert.equal(url,"https://api.sandbox.midtrans.com/v2/bor-123/status");
 assert.equal(opts.method,"GET");assert.equal(opts.redirect,"manual");
 assert.equal(opts.headers.Authorization,"Basic "+btoa(key+":"));
 return {ok:code===200,text:async()=>JSON.stringify(payload)};
};
test("sandbox status verification returns candidate only, never credits",async()=>{
 const result=await checkMidtransSandboxOrder(order,{serverKey:key,expectedMerchantId:"M123",fetchImpl:fake(status)});
 assert.deepEqual(result,{classification:{kind:"paid_candidate"},providerTransactionId:"tx-123",merchantId:"M123",verifiedVia:"sandbox_status_api"});
});
test("reject mismatched amount, order, currency, merchant identity and status",async()=>{
 for(const patch of [{gross_amount:"36255.00"},{order_id:"other"},{currency:"USD"},{merchant_id:null},{status_code:"404"}])
  await assert.rejects(()=>checkMidtransSandboxOrder(order,{serverKey:key,expectedMerchantId:"M123",fetchImpl:fake({...status,...patch})}));
});
test("reject production orders, invalid keys, upstream errors and unknown state",async()=>{
 await assert.rejects(()=>checkMidtransSandboxOrder({...order,environment:"production"},{serverKey:key,expectedMerchantId:"M123",fetchImpl:fake(status)}));
 await assert.rejects(()=>checkMidtransSandboxOrder(order,{serverKey:"live-key",expectedMerchantId:"M123",fetchImpl:fake(status)}));
 await assert.rejects(()=>checkMidtransSandboxOrder(order,{serverKey:key,expectedMerchantId:"M123",fetchImpl:fake(status,503)}));
 const result=await checkMidtransSandboxOrder(order,{serverKey:key,expectedMerchantId:"M123",fetchImpl:fake({...status,transaction_status:"unknown"})});
 assert.equal(result.classification.kind,"manual_review");
});

test("reject wrong or missing configured merchant identity",async()=>{
 await assert.rejects(()=>checkMidtransSandboxOrder(order,{serverKey:key,fetchImpl:fake(status)}),/merchant ID required/);
 await assert.rejects(()=>checkMidtransSandboxOrder(order,{serverKey:key,expectedMerchantId:"M999",fetchImpl:fake(status)}),/merchant mismatch/);
});

test("reject oversized streamed Midtrans status before buffering the full body", async () => {
 const stream = new ReadableStream({
   start(controller) {
     controller.enqueue(new Uint8Array(32000));
     controller.enqueue(new Uint8Array(1024));
     controller.close();
   }
 });
 await assert.rejects(
   checkMidtransSandboxOrder(order, {
     serverKey:key, expectedMerchantId:"M123",
     fetchImpl:async()=>new Response(stream, {status:200}),
   }),
   /response too large/
 );
});

test("reject oversized advertised Content-Length without consuming status", async () => {
 const fetchImpl=async()=>new Response(JSON.stringify(status), {
   status:200, headers:{"Content-Length":"32769"},
 });
 await assert.rejects(
   checkMidtransSandboxOrder(order, {serverKey:key,expectedMerchantId:"M123",fetchImpl}),
   /response too large/
 );
});

test("reject malformed streamed UTF-8 instead of silently replacing bytes", async () => {
 const fetchImpl=async()=>new Response(new Uint8Array([0xc3, 0x28]), {status:200});
 await assert.rejects(
   checkMidtransSandboxOrder(order, {serverKey:key,expectedMerchantId:"M123",fetchImpl}),
   /encoded|UTF-8|valid/i
 );
});
