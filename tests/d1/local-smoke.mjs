// Explicitly opt-in local Cloudflare D1 smoke test. Never targets a remote database.
// Run: node tests/d1/local-smoke.mjs (requires Node.js and npx).
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
const temp=mkdtempSync(join(tmpdir(),"bor-ai-d1-"));
const config=join(temp,"wrangler.jsonc");
const dbName="bor-ai-payment-test";
const schema=readFileSync(new URL("../../docs/sql/payment-orders-review.sql",import.meta.url),"utf8");
const base="CREATE TABLE credit_accounts(user_id TEXT PRIMARY KEY,balance_microcredits INTEGER NOT NULL CHECK(balance_microcredits>=0),updated_at INTEGER NOT NULL); CREATE TABLE credit_ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,delta_microcredits INTEGER NOT NULL,reason TEXT NOT NULL,reference_id TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,reason,reference_id));";
writeFileSync(config,JSON.stringify({name:"bor-ai-payment-d1-local-test",main:resolve("src/index.js"),compatibility_date:"2026-10-28",d1_databases:[{binding:"DB",database_name:dbName,database_id:"00000000-0000-4000-8000-000000000001"}]}));
const run=(sql,expectedError=null)=>{
 const file=join(temp,"query.sql");writeFileSync(file,sql);
 let output="",exitError=null;
 try{
  output=execFileSync("npx",["--yes","wrangler@4","d1","execute",dbName,"--local","--config",config,"--persist-to",join(temp,"state"),"--file",file,"--json"],{encoding:"utf8",timeout:120000,stdio:["ignore","pipe","pipe"]});
 }catch(e){exitError=e;output=String(e.stdout||"");}
 let parsed;
 try{parsed=JSON.parse(output.trim())}catch{
  throw new Error("Wrangler did not return valid JSON: "+String(exitError?.stderr||output||exitError?.message).slice(0,1000));
 }
 const error=parsed?.error?.text || (Array.isArray(parsed) ? parsed.find(x=>x?.error)?.error?.text : null);
 if(expectedError){
  assert.match(String(error||""),expectedError,"Expected specific D1 constraint error");
  return parsed;
 }
 if(exitError||error)throw new Error("D1 execution failed: "+String(error||exitError?.stderr||exitError?.message));
 return parsed;
};
try{
 run(base+"\n"+schema);
 const insert="INSERT INTO payment_orders(order_id,user_id,sku,environment,currency,amount_idr,grant_microcredits,state,created_at,updated_at) VALUES ('order1','u','basic','sandbox','IDR',100,25,'created',1,1);";
 run(insert);
 run("UPDATE payment_orders SET state='fulfilled' WHERE order_id='order1';",/payment_provider_transaction_required|payment_fulfillment_transition_invalid/);
 run("UPDATE payment_orders SET state='paid_unfulfilled' WHERE order_id='order1';",/payment_provider_transaction_required/);
 run("UPDATE payment_orders SET state='paid_unfulfilled',provider_transaction_id='tx1' WHERE order_id='order1';");
 run("UPDATE payment_orders SET state='fulfilled',updated_at=2 WHERE order_id='order1';");
 run("UPDATE payment_orders SET state='fulfilled',updated_at=3 WHERE order_id='order1' AND state='paid_unfulfilled';");
 run("UPDATE payment_orders SET state='fulfilled',updated_at=3 WHERE order_id='order1';",/payment_fulfillment_transition_invalid/);
 const out=run("SELECT (SELECT balance_microcredits FROM credit_accounts WHERE user_id='u') AS balance,(SELECT count(*) FROM credit_ledger) AS grants,(SELECT state FROM payment_orders WHERE order_id='order1') AS state;");
 const row=out[0]?.results?.[0];
 assert.deepEqual({balance:row?.balance,grants:row?.grants,state:row?.state},{balance:25,grants:1,state:"fulfilled"});
 // A ledger uniqueness conflict must roll back the balance increment and state transition.
 run("INSERT INTO payment_orders(order_id,user_id,sku,environment,currency,amount_idr,grant_microcredits,state,created_at,updated_at) VALUES ('order2','u','basic','sandbox','IDR',100,17,'created',4,4);");
 run("UPDATE payment_orders SET state='paid_unfulfilled',provider_transaction_id='tx2' WHERE order_id='order2';");
 run("INSERT INTO credit_ledger(id,user_id,delta_microcredits,reason,reference_id,created_at) VALUES ('payment:order2','u',1,'test_conflict','collision',4);");
 run("UPDATE payment_orders SET state='fulfilled',updated_at=5 WHERE order_id='order2';",/SQLITE_CONSTRAINT/);
 const rollback=run("SELECT (SELECT balance_microcredits FROM credit_accounts WHERE user_id='u') AS balance,(SELECT state FROM payment_orders WHERE order_id='order2') AS state,(SELECT count(*) FROM credit_ledger WHERE id='payment:order2') AS conflicting_rows;");
 assert.deepEqual(rollback[0]?.results?.[0],{balance:25,state:"paid_unfulfilled",conflicting_rows:1});
 // A credit overflow must not partially fulfill an order.
 run("INSERT INTO credit_accounts(user_id,balance_microcredits,updated_at) VALUES ('overflow',9007199254740990,6);");
 run("INSERT INTO payment_orders(order_id,user_id,sku,environment,currency,amount_idr,grant_microcredits,state,created_at,updated_at) VALUES ('order3','overflow','basic','sandbox','IDR',100,25,'created',6,6);");
 run("UPDATE payment_orders SET state='paid_unfulfilled',provider_transaction_id='tx3' WHERE order_id='order3';");
 run("UPDATE payment_orders SET state='fulfilled',updated_at=7 WHERE order_id='order3';",/payment_grant_account_missing_or_overflow/);
 const overflow=run("SELECT (SELECT balance_microcredits FROM credit_accounts WHERE user_id='overflow') AS balance,(SELECT state FROM payment_orders WHERE order_id='order3') AS state,(SELECT count(*) FROM credit_ledger WHERE reference_id='order3') AS grants;");
 assert.deepEqual(overflow[0]?.results?.[0],{balance:9007199254740990,state:"paid_unfulfilled",grants:0});
 console.log("PASS: local D1 atomic rollback on ledger conflict and credit overflow");
 console.log("PASS: local Cloudflare D1 paid-state guard, atomic credit and duplicate idempotency");
}finally{rmSync(temp,{recursive:true,force:true})}
