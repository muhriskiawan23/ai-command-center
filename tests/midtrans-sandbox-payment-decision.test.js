import test from "node:test";
import assert from "node:assert/strict";
import {decideSandboxPaymentConfirmation} from "../src/midtrans-sandbox-payment-decision.js";
const order={orderId:"bor-123",amountIdr:36254,currency:"IDR",environment:"sandbox"};
const webhook={classification:{kind:"paid_candidate"},providerTransactionId:"tx1",requiresStatusApiConfirmation:true};
const api={classification:{kind:"paid_candidate"},providerTransactionId:"tx1",merchantId:"M123",verifiedVia:"sandbox_status_api"};
test("requires matching independent paid confirmation",()=>{
 assert.deepEqual(decideSandboxPaymentConfirmation(order,webhook,api),{kind:"verified_paid_candidate",providerTransactionId:"tx1",merchantId:"M123",environment:"sandbox",orderId:"bor-123"});
});
test("fail closed for pending, missing, inconsistent and unverified evidence",()=>{
 for(const [w,a] of [
  [null,api],[webhook,null],
  [{...webhook,classification:{kind:"pending"}},api],
  [webhook,{...api,classification:{kind:"manual_review"}}],
  [webhook,{...api,providerTransactionId:"tx2"}],
  [webhook,{...api,verifiedVia:"webhook"}],
  [webhook,{...api,merchantId:""}]
 ]) assert.equal(decideSandboxPaymentConfirmation(order,w,a).kind,"not_confirmed");
});
test("reject production order",()=>{
 assert.throws(()=>decideSandboxPaymentConfirmation({...order,environment:"production"},webhook,api));
});
