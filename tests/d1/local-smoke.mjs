// Explicitly opt-in local Cloudflare D1 smoke test. Never targets a remote database.
// Run: npx --yes wrangler@4 d1 execute bor-ai-payment-test --local --config tests/d1/wrangler.jsonc --file tests/d1/fixture.sql
// Then run the assertions below using a disposable local DB.
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
const run=(sql,expectFailure=false)=>{
 const file=join(temp,"query.sql");writeFileSync(file,sql);
 try{
  const out=execFileSync("npx",["--yes","wrangler@4","d1","execute",dbName,"--local","--config",config,"--persist-to",join(temp,"state"),"--file",file,"--json"],{encoding:"utf8",timeout:120000,stdio:["ignore","pipe","pipe"]});
  if(expectFailure)throw Error("Expected D1 statement to fail but it succeeded");
  return out;
 }catch(e){if(!expectFailure)throw e; if(e.message==="Expected D1 statement to fail but it succeeded")throw e;return String(e.stderr||e.message)}
};
try{
 run(base+"\n"+schema);
 const insert="INSERT INTO payment_orders(order_id,user_id,sku,environment,currency,amount_idr,grant_microcredits,state,created_at,updated_at) VALUES ('order1','u','basic','sandbox','IDR',100,25,'created',1,1);";
 run(insert);
 run("UPDATE payment_orders SET state='fulfilled' WHERE order_id='order1';",true);
 run("UPDATE payment_orders SET state='paid_unfulfilled' WHERE order_id='order1';",true);
 run("UPDATE payment_orders SET state='paid_unfulfilled',provider_transaction_id='tx1' WHERE order_id='order1';");
 run("UPDATE payment_orders SET state='fulfilled',updated_at=2 WHERE order_id='order1';");
 run("UPDATE payment_orders SET state='fulfilled',updated_at=3 WHERE order_id='order1';");
 const out=run("SELECT (SELECT balance_microcredits FROM credit_accounts WHERE user_id='u') AS balance,(SELECT count(*) FROM credit_ledger) AS grants,(SELECT state FROM payment_orders WHERE order_id='order1') AS state;");
 const data=JSON.parse(out);const row=data[0]?.results?.[0];
 assert.deepEqual({balance:row?.balance,grants:row?.grants,state:row?.state},{balance:25,grants:1,state:"fulfilled"});
 console.log("PASS: local Cloudflare D1 paid-state guard, atomic credit and duplicate idempotency");
}finally{rmSync(temp,{recursive:true,force:true})}
