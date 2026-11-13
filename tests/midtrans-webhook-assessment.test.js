import test from "node:test";
import assert from "node:assert/strict";
import {midtransSignature} from "../src/midtrans-signature.js";
import {assessMidtransSandboxNotification} from "../src/midtrans-webhook-assessment.js";
const key="SB-Mid-server-FAKE-TEST-KEY",merchant="M123";
const order={orderId:"bor-123",amountIdr:36254,currency:"IDR",environment:"sandbox"};
const base={order_id:"bor-123",status_code:"200",gross_amount:"36254.00",currency:"IDR",merchant_id:merchant,transaction_id:"tx123",transaction_status:"settlement"};
async function signed(p){return {...p,signature_key:await midtransSignature(p,key)};}
const assess=p=>assessMidtransSandboxNotification(order,p,{serverKey:key,expectedMerchantId:merchant});
test("signed settlement is candidate, not authorization to grant",async()=>{
 const result=await assess(await signed(base));
 assert.deepEqual(result,{classification:{kind:"paid_candidate"},providerTransactionId:"tx123",requiresStatusApiConfirmation:true});
});
test("signed pending does not require paid status confirmation",async()=>{
 const result=await assess(await signed({...base,transaction_status:"pending"}));
 assert.equal(result.classification.kind,"pending");
 assert.equal(result.requiresStatusApiConfirmation,false);
});
test("reject signature tampering, signed wrong merchant, amount, order, currency and missing transaction",async()=>{
 const good=await signed(base);
 await assert.rejects(()=>assess({...good,gross_amount:"1.00"}),/signature/);
 for(const patch of [{merchant_id:"M999"},{gross_amount:"36255.00"},{order_id:"other"},{currency:"USD"},{transaction_id:null}]) {
   const signedPayload=await signed({...base,...patch});
   await assert.rejects(()=>assess(signedPayload));
 }
});
test("reject missing merchant config and production order",async()=>{
 const good=await signed(base);
 await assert.rejects(()=>assessMidtransSandboxNotification(order,good,{serverKey:key}),/merchant ID required/);
 await assert.rejects(()=>assessMidtransSandboxNotification({...order,environment:"production"},good,{serverKey:key,expectedMerchantId:merchant}),/Sandbox order required/);
});
