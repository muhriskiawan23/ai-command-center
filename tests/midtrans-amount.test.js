import test from "node:test";
import assert from "node:assert/strict";
import { parseMidtransGrossAmountIdr, assertMidtransPaymentMatchesOrder } from "../src/midtrans-amount.js";
test("accept exact whole-rupiah amounts without float rounding",()=>{
 for(const value of ["36254","36254.0","36254.00"]) assert.equal(parseMidtransGrossAmountIdr(value),36254);
 assert.equal(parseMidtransGrossAmountIdr("9007199254740991.00"),Number.MAX_SAFE_INTEGER);
});
test("reject fractions, invalid notation, non-string and unsafe amounts",()=>{
 for(const value of ["36254.01","36254.10","36254.001","1e4","036254","-1","0","0.00","9007199254740992.00"," 36254",36254,null,"1,000.00","1."]) assert.throws(()=>parseMidtransGrossAmountIdr(value));
});
test("reject order mismatch, amount mismatch and environment mismatch",()=>{
 const o={orderId:"bor-123",amountIdr:36254,currency:"IDR",environment:"sandbox"};
 const p={order_id:"bor-123",gross_amount:"36254.00"};
 assert.equal(assertMidtransPaymentMatchesOrder(o,p,"sandbox"),true);
 assert.throws(()=>assertMidtransPaymentMatchesOrder(o,{...p,gross_amount:"36255.00"},"sandbox"));
 assert.throws(()=>assertMidtransPaymentMatchesOrder(o,{...p,order_id:"bor-124"},"sandbox"));
 assert.throws(()=>assertMidtransPaymentMatchesOrder(o,p,"production"));
 assert.throws(()=>assertMidtransPaymentMatchesOrder({...o,currency:"USD"},p,"sandbox"));
});
