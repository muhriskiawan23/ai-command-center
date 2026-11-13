import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
const schema=readFileSync(new URL("../docs/sql/payment-orders-review.sql",import.meta.url),"utf8");
function setup(){
 const db=new DatabaseSync(":memory:");
 db.exec("CREATE TABLE credit_accounts(user_id TEXT PRIMARY KEY,balance_microcredits INTEGER NOT NULL CHECK(balance_microcredits>=0),updated_at INTEGER NOT NULL);");
 db.exec("CREATE TABLE credit_ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,delta_microcredits INTEGER NOT NULL,reason TEXT NOT NULL,reference_id TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,reason,reference_id));");
 db.exec(schema);
 const insert=(id,user="user-a",amount=100)=>db.prepare("INSERT INTO payment_orders(order_id,user_id,sku,environment,currency,amount_idr,grant_microcredits,state,created_at,updated_at) VALUES (?,?, 'basic','sandbox','IDR',36254,?,'paid_unfulfilled',1,1)").run(id,user,amount);
 const fulfill=id=>db.prepare("UPDATE payment_orders SET state='fulfilled',updated_at=2 WHERE order_id=? AND state='paid_unfulfilled'").run(id);
 const balance=user=>db.prepare("SELECT balance_microcredits FROM credit_accounts WHERE user_id=?").get(user)?.balance_microcredits ?? 0;
 return {db,insert,fulfill,balance};
}
test("one fulfillment grants exactly once; duplicate event changes zero rows",()=>{
 const x=setup();try{
 x.insert("o1");assert.equal(x.fulfill("o1").changes,1);assert.equal(x.balance("user-a"),100);
 assert.equal(x.fulfill("o1").changes,0);assert.equal(x.balance("user-a"),100);
 assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM credit_ledger").get().n,1);
 }finally{x.db.close();}
});
test("different users and orders remain isolated",()=>{
 const x=setup();try{x.insert("a","user-a",25);x.insert("b","user-b",70);x.fulfill("a");x.fulfill("b");assert.equal(x.balance("user-a"),25);assert.equal(x.balance("user-b"),70);}finally{x.db.close();}
});
test("failed journal aborts entire fulfillment and balance change",()=>{
 const x=setup();try{
 x.insert("o1");x.db.prepare("INSERT INTO credit_ledger VALUES('payment:o1','user-a',100,'payment_grant','o1',1)").run();
 assert.throws(()=>x.fulfill("o1"));
 assert.equal(x.balance("user-a"),0);
 assert.equal(x.db.prepare("SELECT state FROM payment_orders WHERE order_id='o1'").get().state,"paid_unfulfilled");
 }finally{x.db.close();}
});
test("reject direct fulfillment, mutation, deletion and overflow",()=>{
 const x=setup();try{
 x.insert("o1");assert.throws(()=>x.db.exec("UPDATE payment_orders SET user_id='attacker' WHERE order_id='o1'"));
 assert.throws(()=>x.db.exec("DELETE FROM payment_orders WHERE order_id='o1'"));
 assert.throws(()=>x.db.exec("UPDATE payment_orders SET state='pending' WHERE order_id='o1'"));
 }finally{x.db.close();}
});
