// Trusted sandbox reversal handler only; local SQLite + synthetic provider replies.
// These tests NEVER contact Midtrans or change a remote D1 database.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {handleSandboxReversal} from "../src/midtrans-sandbox-reversal.js";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const merchant="M123",key="SB-Mid-server-FAKE-ONLY";
function fixture(t){
 const sqlite=new DatabaseSync(":memory:");
 t.after(()=>sqlite.close());
 sqlite.exec(read("../tools/midtrans-sandbox/credit-fixture.sql"));
 sqlite.exec(read("../docs/sql/payment-orders-review.sql"));
 sqlite.exec(read("../docs/sql/payment-reversals-review.sql"));
 sqlite.exec(`
   INSERT INTO payment_orders VALUES ('order','tester','fixture','sandbox','IDR',10000,25,'created',NULL,1,1);
   UPDATE payment_orders SET state='paid_unfulfilled',provider_transaction_id='tx' WHERE order_id='order';
   UPDATE payment_orders SET state='fulfilled' WHERE order_id='order';
 `);
 const db={
  prepare(sql){
   const statement=sqlite.prepare(sql);
   return {bind(...params){
    return {
     first:async()=>statement.get(...params),
     run:async()=>statement.run(...params),
     _all:()=>statement.all(...params)
    };
   }};
  },
  async batch(statements){
   sqlite.exec("BEGIN IMMEDIATE");
   try{
    const out=statements.map(statement=>({results:statement._all()}));
    sqlite.exec("COMMIT");
    return out;
   }catch(error){sqlite.exec("ROLLBACK");throw error;}
  }
 };
 const payment=()=>sqlite.prepare("SELECT state FROM payment_orders WHERE order_id='order'").get().state;
 const balance=()=>sqlite.prepare("SELECT balance_microcredits AS balance FROM credit_accounts WHERE user_id='tester'").get().balance;
 const ledger=()=>sqlite.prepare("SELECT delta_microcredits AS delta FROM credit_ledger ORDER BY created_at,delta_microcredits DESC").all().map(x=>x.delta);
 const reviews=()=>sqlite.prepare("SELECT provider_status FROM sandbox_payment_reversal_reviews ORDER BY provider_status").all().map(x=>x.provider_status);
 return {sqlite,db,payment,balance,ledger,reviews};
}
function fullRefund(){
 return {
  order_id:"order",transaction_id:"tx",gross_amount:"10000.00",currency:"IDR",
  status_code:"200",merchant_id:merchant,transaction_status:"refund",
  refund_amount:"10000.00",
  refunds:[{refund_chargeback_id:1,refund_amount:"10000.00",bank_confirmed_at:"2026-11-15 14:00:00"}]
 };
}
const process=(db,payload,provider=payload)=>handleSandboxReversal({
 db,payload,serverKey:key,expectedMerchantId:merchant,
 fetchImpl:async()=>Response.json(provider)
});

test("a new chargeback after a completed refund is recorded for review, not silently ignored or double-debited",async t=>{
 const x=fixture(t), refund=fullRefund();
 assert.equal(await process(x.db,refund),"reversed");
 assert.equal(x.payment(),"refunded");
 assert.equal(x.balance(),0);
 assert.deepEqual(x.ledger(),[25,-25]);
 assert.equal(await process(x.db,refund),"unchanged");
 const chargeback={...refund,transaction_status:"chargeback"};
 assert.equal(await process(x.db,chargeback),"review_required");
 assert.deepEqual(x.reviews(),["chargeback"]);
 assert.equal(x.payment(),"refunded");
 assert.equal(x.balance(),0);
 assert.deepEqual(x.ledger(),[25,-25]);
 assert.equal(await process(x.db,chargeback),"review_required");
 assert.deepEqual(x.reviews(),["chargeback"]);
 assert.deepEqual(x.ledger(),[25,-25]);
});
test("provider-verified partial reversal after full refund adds review marker without a second credit adjustment",async t=>{
 const x=fixture(t),refund=fullRefund();
 assert.equal(await process(x.db,refund),"reversed");
 const partial={...refund,transaction_status:"partial_refund"};
 assert.equal(await process(x.db,partial),"review_required");
 assert.deepEqual(x.reviews(),["partial_refund"]);
 assert.equal(x.balance(),0);
 assert.equal(x.payment(),"refunded");
 assert.deepEqual(x.ledger(),[25,-25]);
});
test("mismatched or unverified provider dispute cannot create review markers after refund",async t=>{
 const x=fixture(t),refund=fullRefund();
 assert.equal(await process(x.db,refund),"reversed");
 const chargeback={...refund,transaction_status:"chargeback"};
 await assert.rejects(process(x.db,chargeback,{...chargeback,merchant_id:"OTHER"}),/merchant mismatch/);
 assert.equal(await process(x.db,chargeback,{...refund,transaction_status:"settlement"}),"retry");
 assert.deepEqual(x.reviews(),[]);
 assert.equal(x.balance(),0);
 assert.deepEqual(x.ledger(),[25,-25]);
});
