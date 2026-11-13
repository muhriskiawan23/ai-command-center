import test from "node:test";
import assert from "node:assert/strict";
import { transitionOrder, validateOrderPaymentMatch } from "../src/payment-order-state.js";
test("verified payment moves pending to paid_unfulfilled but never directly grants", () => {
  assert.deepEqual(transitionOrder("pending", "paid_unfulfilled", { verified: true }), { state:"paid_unfulfilled", changed:true });
  assert.throws(() => transitionOrder("paid_unfulfilled", "fulfilled", { verified:true }), /atomically/);
});
test("unverified, duplicate, and invalid transitions", () => {
  assert.throws(() => transitionOrder("pending", "paid_unfulfilled"), /Verified/);
  assert.deepEqual(transitionOrder("paid_unfulfilled", "paid_unfulfilled"), {state:"paid_unfulfilled",changed:false});
  assert.throws(() => transitionOrder("failed", "paid_unfulfilled", {verified:true}), /Invalid/);
  assert.throws(() => transitionOrder("expired", "pending"), /Invalid/);
  assert.throws(() => transitionOrder("pending", "refunded", {verified:true}), /Invalid/);
});
test("reject cross-order, incorrect IDR amount, currency and environment", () => {
  const o={orderId:"order-1",amountIdr:36254,currency:"IDR",environment:"sandbox"};
  const e={...o};
  assert.equal(validateOrderPaymentMatch(o,e),true);
  for(const changes of [{orderId:"order-2"},{amountIdr:36255},{currency:"USD"},{environment:"production"}])
    assert.throws(()=>validateOrderPaymentMatch(o,{...e,...changes}));
  assert.throws(()=>validateOrderPaymentMatch({...o,amountIdr:1.5},e));
});
