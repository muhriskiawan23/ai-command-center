import test from "node:test";
import assert from "node:assert/strict";
import { classifyMidtransStatus } from "../src/midtrans-status.js";
test("capture requires explicit fraud acceptance",()=>{
 assert.deepEqual(classifyMidtransStatus({transaction_status:"capture",fraud_status:"accept"}),{kind:"paid_candidate"});
 for(const fraud_status of [undefined,"challenge","deny"]) assert.equal(classifyMidtransStatus({transaction_status:"capture",fraud_status}).kind,"manual_review");
});
test("settlement and pending are interpreted without granting",()=>{
 assert.equal(classifyMidtransStatus({transaction_status:"settlement"}).kind,"paid_candidate");
 assert.equal(classifyMidtransStatus({transaction_status:"settlement",fraud_status:"challenge"}).kind,"manual_review");
 assert.equal(classifyMidtransStatus({transaction_status:"pending"}).kind,"pending");
});
test("failure, refund and unknown status fail closed",()=>{
 for(const status of ["deny","cancel","expire","failure"]) assert.equal(classifyMidtransStatus({transaction_status:status}).kind,"failed_candidate");
 for(const status of ["refund","partial_refund","chargeback","future_new_status"]) assert.equal(classifyMidtransStatus({transaction_status:status}).kind,"manual_review");
 assert.throws(()=>classifyMidtransStatus({}),/Missing/);
 assert.throws(()=>classifyMidtransStatus(null),/Notification/);
});
