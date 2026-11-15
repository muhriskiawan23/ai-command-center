// Explicitly opt-in local Cloudflare D1 smoke test. Never targets a remote database.
// Run: node tests/d1/local-smoke.mjs (requires Node.js and npm).
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fulfillVerifiedSandboxPayment} from "../../src/midtrans-sandbox-fulfillment.js";
// The platform proxy runs local D1 only. The provider response is a test fixture.
process.env.WRANGLER_SEND_METRICS="false";
const temp=mkdtempSync(join(tmpdir(),"bor-ai-d1-"));
const config=join(temp,"wrangler.jsonc");
const persistencePath=join(temp,"state");
const dbName="bor-ai-payment-test";
const schema=readFileSync(new URL("../../docs/sql/payment-orders-review.sql",import.meta.url),"utf8");
const base="CREATE TABLE credit_accounts(user_id TEXT PRIMARY KEY,balance_microcredits INTEGER NOT NULL CHECK(balance_microcredits>=0),updated_at INTEGER NOT NULL); CREATE TABLE credit_ledger(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,delta_microcredits INTEGER NOT NULL,reason TEXT NOT NULL,reference_id TEXT NOT NULL,created_at INTEGER NOT NULL,UNIQUE(user_id,reason,reference_id));";
writeFileSync(config,JSON.stringify({name:"bor-ai-payment-d1-local-test",main:resolve("src/index.js"),compatibility_date:"2026-10-28",d1_databases:[{binding:"DB",database_name:dbName,database_id:"00000000-0000-4000-8000-000000000001"}]}));
const run=(sql,expectedError=null)=>{
 const file=join(temp,"query.sql");writeFileSync(file,sql);
 let output="",exitError=null;
 try{
  output=execFileSync(process.execPath,[join(temp,"node_modules","wrangler","bin","wrangler.js"),"d1","execute",dbName,"--local","--config",config,"--persist-to",persistencePath,"--file",file,"--json"],{encoding:"utf8",timeout:120000,stdio:["ignore","pipe","pipe"]});
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
 execFileSync("npm",["install","--prefix",temp,"--no-save","--no-package-lock","--no-audit","--no-fund","wrangler@4"],{stdio:"inherit",timeout:180000});
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
 // One provider transaction cannot fund two orders in the same environment.
 run("INSERT INTO payment_orders(order_id,user_id,sku,environment,currency,amount_idr,grant_microcredits,state,created_at,updated_at) VALUES ('order4','u','basic','sandbox','IDR',100,9,'created',8,8);");
 run("UPDATE payment_orders SET state='paid_unfulfilled',provider_transaction_id='tx1' WHERE order_id='order4';",/UNIQUE constraint failed/);
 const duplicate=run("SELECT state,provider_transaction_id FROM payment_orders WHERE order_id='order4';");
 assert.deepEqual(duplicate[0]?.results?.[0],{state:"created",provider_transaction_id:null});
 // An already bound transaction identity must never be replaced.
 run("UPDATE payment_orders SET provider_transaction_id='tx-changed' WHERE order_id='order1';",/payment_provider_transaction_immutable/);
 const original=run("SELECT state,provider_transaction_id FROM payment_orders WHERE order_id='order1';");
 assert.deepEqual(original[0]?.results?.[0],{state:"fulfilled",provider_transaction_id:"tx1"});
 console.log("PASS: local D1 provider transaction uniqueness and immutable identity");
 console.log("PASS: local Cloudflare D1 paid-state guard, atomic credit and duplicate idempotency");

 const orderId="concurrent-order";
 const transactionId="concurrent-transaction";
 const serverKey="SB-Mid-server-synthetic-fixture";
 const merchantId="synthetic-merchant";
 const payload={
  order_id:orderId,
  gross_amount:"100.00",
  transaction_status:"settlement",
  transaction_id:transactionId,
  merchant_id:merchantId,
  status_code:"200",
  currency:"IDR",
  signature_key:createHash("sha512").update(orderId+"200"+"100.00"+serverKey).digest("hex"),
 };
 run("INSERT INTO payment_orders(order_id,user_id,sku,environment,currency,amount_idr,grant_microcredits,state,created_at,updated_at) VALUES ('concurrent-order','concurrent-user','basic','sandbox','IDR',100,25,'created',1,1);");
 const {getPlatformProxy}=createRequire(join(temp,"package.json"))("wrangler");
 // The CLI appends v3 to --persist-to; the proxy takes the versioned path.
 const platform=await getPlatformProxy({
  configPath:config,remoteBindings:false,persist:{path:join(persistencePath,"v3")},
 });
 try{
  const db=platform.env.DB;
  const fulfill=()=>fulfillVerifiedSandboxPayment({
   db,orderId,payload,serverKey,expectedMerchantId:merchantId,
   fetchImpl:async()=>Response.json(payload),
  });
  const results=await Promise.all(Array.from({length:20},fulfill));
  assert.equal(results.filter(result=>result.kind==="fulfilled").length,1);
  assert.equal(results.filter(result=>result.kind==="unchanged").length,19);
  const order=await db.prepare("SELECT state,provider_transaction_id FROM payment_orders WHERE order_id=?").bind(orderId).first();
  assert.deepEqual({...order},{state:"fulfilled",provider_transaction_id:transactionId});
  const account=await db.prepare("SELECT balance_microcredits FROM credit_accounts WHERE user_id=?").bind("concurrent-user").first();
  assert.equal(account?.balance_microcredits,25);
  const ledger=await db.prepare("SELECT delta_microcredits FROM credit_ledger WHERE reference_id=?").bind(orderId).all();
  assert.deepEqual(ledger.results.map(row=>row.delta_microcredits),[25]);
  console.log("PASS: 20 concurrent synthetic callbacks grant credit once through local D1.batch()");
 }finally{await platform.dispose()}
}finally{rmSync(temp,{recursive:true,force:true})}
