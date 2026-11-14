import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {fulfillVerifiedSandboxPayment} from "../src/midtrans-sandbox-fulfillment.js";
import {createHash} from "node:crypto";
const schema=readFileSync(new URL("../docs/sql/payment-orders-review.sql",import.meta.url),"utf8");
const key="SB-Mid-server-test",merchant="M123",id="order1";
function setup(){
 const sqlite=new DatabaseSync(":memory:");
 sqlite.exec("CREATE TABLE credit_accounts(user_id TEXT PRIMARY KEY,balance_microcredits INTEGER NOT NULL CHECK(balance_microcredits>=0),updated_at INTEGER NOT NULL)");
 sqlite.exec("CREATE TABLE credit_ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,delta_microcredits INTEGER NOT NULL,reason TEXT NOT NULL,reference_id TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,reason,reference_id))");
 sqlite.exec(schema);
 sqlite.prepare("INSERT INTO payment_orders(order_id,user_id,sku,environment,currency,amount_idr,grant_microcredits,state,created_at,updated_at) VALUES (?, 'u','basic','sandbox','IDR',100,25,'created',1,1)").run(id);
 const db={
  prepare(sql){const stmt=sqlite.prepare(sql);return {bind(...params){return {first:async()=>stmt.get(...params),_run:()=>stmt.run(...params)}}}},
  async batch(statements){
   sqlite.exec("BEGIN IMMEDIATE");
   try{const out=statements.map(s=>({meta:{changes:s._run().changes}}));sqlite.exec("COMMIT");return out}
   catch(e){sqlite.exec("ROLLBACK");throw e}
  }
 };
 const balance=()=>sqlite.prepare("SELECT balance_microcredits AS b FROM credit_accounts WHERE user_id='u'").get()?.b??0;
 const count=()=>sqlite.prepare("SELECT count(*) AS n FROM credit_ledger").get().n;
 const state=()=>sqlite.prepare("SELECT state FROM payment_orders WHERE order_id=?").get(id).state;
 return {sqlite,db,balance,count,state};
}
function evidence(status="settlement",transaction="tx1"){
 const payload={order_id:id,gross_amount:"100.00",transaction_status:status,transaction_id:transaction,merchant_id:merchant,status_code:"200"};
 payload.signature_key=createHash("sha512").update(id+"200"+"100.00"+key).digest("hex");
 const fetchImpl=async()=>({ok:true,text:async()=>JSON.stringify({...payload,currency:"IDR"})});
 return {payload,fetchImpl};
}
const run=(db,e)=>fulfillVerifiedSandboxPayment({db,orderId:id,serverKey:key,expectedMerchantId:merchant,now:()=>10,...e});
test("verified sandbox settlement credits once and duplicate is idempotent",async()=>{
 const x=setup();try{
  const e=evidence();assert.equal((await run(x.db,e)).kind,"fulfilled");
  assert.equal(x.state(),"fulfilled");assert.equal(x.balance(),25);assert.equal(x.count(),1);
  assert.equal((await run(x.db,e)).kind,"unchanged");assert.equal(x.balance(),25);assert.equal(x.count(),1);
 }finally{x.sqlite.close()}
});
test("pending status cannot grant",async()=>{
 const x=setup();try{assert.equal((await run(x.db,evidence("pending"))).kind,"not_confirmed");assert.equal(x.balance(),0);assert.equal(x.state(),"created")}finally{x.sqlite.close()}
});
test("mismatched provider transaction does not grant",async()=>{
 const x=setup();try{
  const e=evidence();e.fetchImpl=async()=>({ok:true,text:async()=>JSON.stringify({...e.payload,transaction_id:"other",currency:"IDR"})});
  assert.equal((await run(x.db,e)).kind,"not_confirmed");assert.equal(x.balance(),0)
 }finally{x.sqlite.close()}
});
test("ledger collision rolls back order and balance",async()=>{
 const x=setup();try{
  x.sqlite.prepare("INSERT INTO credit_ledger VALUES(?,?,?,?,?,?)").run("payment:"+id,"u",25,"payment_grant",id,1);
  await assert.rejects(run(x.db,evidence()));
  assert.equal(x.state(),"created");assert.equal(x.balance(),0);assert.equal(x.count(),1)
 }finally{x.sqlite.close()}
});

test("concurrent duplicate notifications credit exactly once",async()=>{
 const x=setup();try{
  const e=evidence();
  const outcomes=await Promise.all(Array.from({length:12},()=>run(x.db,e)));
  assert.equal(outcomes.filter(v=>v.kind==="fulfilled").length,1);
  assert.equal(outcomes.filter(v=>v.kind==="unchanged").length,11);
  assert.equal(x.balance(),25);assert.equal(x.count(),1);assert.equal(x.state(),"fulfilled");
 }finally{x.sqlite.close()}
});
test("status API outage fails closed with no ledger mutation",async()=>{
 const x=setup();try{
  const e=evidence();e.fetchImpl=async()=>{throw new Error("network unavailable")};
  await assert.rejects(run(x.db,e));
  assert.equal(x.balance(),0);assert.equal(x.count(),0);assert.equal(x.state(),"created");
 }finally{x.sqlite.close()}
});
test("status API merchant mismatch fails closed",async()=>{
 const x=setup();try{
  const e=evidence();e.fetchImpl=async()=>({ok:true,text:async()=>JSON.stringify({...e.payload,merchant_id:"OTHER"})});
  await assert.rejects(run(x.db,e));
  assert.equal(x.balance(),0);assert.equal(x.count(),0);assert.equal(x.state(),"created");
 }finally{x.sqlite.close()}
});
test("invalid webhook signature fails closed",async()=>{
 const x=setup();try{
  const e=evidence();e.payload.signature_key="invalid";
  await assert.rejects(run(x.db,e));
  assert.equal(x.balance(),0);assert.equal(x.count(),0);assert.equal(x.state(),"created");
 }finally{x.sqlite.close()}
});

test("sandbox order environment cannot be changed to production",()=>{
 const x=setup();try{
  assert.throws(
   ()=>x.sqlite.prepare("UPDATE payment_orders SET environment='production' WHERE order_id=?").run(id),
   /payment_order_identity_immutable/
  );
  assert.equal(x.sqlite.prepare("SELECT environment FROM payment_orders WHERE order_id=?").get(id).environment,"sandbox");
  assert.equal(x.balance(),0);assert.equal(x.count(),0);
 }finally{x.sqlite.close()}
});
test("production orders cannot receive sandbox fulfillment",async()=>{
 const x=setup();try{
  x.sqlite.prepare("INSERT INTO payment_orders(order_id,user_id,sku,environment,currency,amount_idr,grant_microcredits,state,created_at,updated_at) VALUES ('production1','u','basic','production','IDR',100,25,'created',1,1)").run();
  const result=await fulfillVerifiedSandboxPayment({db:x.db,orderId:"production1",payload:evidence().payload,serverKey:key,expectedMerchantId:merchant});
  assert.equal(result.kind,"not_confirmed");
  assert.equal(x.sqlite.prepare("SELECT state FROM payment_orders WHERE order_id='production1'").get().state,"created");
  assert.equal(x.balance(),0);assert.equal(x.count(),0);
 }finally{x.sqlite.close()}
});
test("unsafe order ID is rejected before any database access",async()=>{
 const x=setup();try{
  await assert.rejects(fulfillVerifiedSandboxPayment({db:x.db,orderId:"../order1",payload:evidence().payload,serverKey:key,expectedMerchantId:merchant}),/Safe order ID/);
  assert.equal(x.balance(),0);assert.equal(x.count(),0);assert.equal(x.state(),"created");
 }finally{x.sqlite.close()}
});
