// Explicitly opt-in local Cloudflare D1 smoke test. Never targets a remote database.
// Run: node tests/d1/local-smoke.mjs (requires Node.js and npm).
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {handleSandboxPayment} from "../../src/midtrans-sandbox-worker.js";
// The platform proxy runs local D1 only. The provider response is a test fixture.
process.env.WRANGLER_SEND_METRICS="false";
const temp=mkdtempSync(join(tmpdir(),"bor-ai-d1-"));
const config=join(temp,"wrangler.jsonc");
const persistencePath=join(temp,"state");
const dbName="bor-ai-payment-test";
const schema=readFileSync(new URL("../../docs/sql/payment-orders-review.sql",import.meta.url),"utf8");
const reversalSchema=readFileSync(new URL("../../docs/sql/payment-reversals-review.sql",import.meta.url),"utf8");
const base=readFileSync(new URL("../../tools/midtrans-sandbox/credit-fixture.sql",import.meta.url),"utf8");
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
 run(base+"\n"+schema+"\n"+reversalSchema);
 const insert="INSERT INTO payment_orders(order_id,user_id,sku,environment,currency,amount_idr,grant_microcredits,state,created_at,updated_at) VALUES ('order1','u','basic','sandbox','IDR',100,25,'created',1,1);";
 run(insert);
 run("UPDATE payment_orders SET state='fulfilled' WHERE order_id='order1';",/payment_provider_transaction_required|payment_fulfillment_transition_invalid/);
 run("UPDATE payment_orders SET state='paid_unfulfilled' WHERE order_id='order1';",/payment_provider_transaction_required/);
 run("UPDATE payment_orders SET state='paid_unfulfilled',provider_transaction_id='tx1' WHERE order_id='order1';");
 run("UPDATE payment_orders SET state='fulfilled',updated_at=2 WHERE order_id='order1';");
 run("UPDATE payment_orders SET state='fulfilled',updated_at=3 WHERE order_id='order1' AND state='paid_unfulfilled';");
 run("UPDATE payment_orders SET state='fulfilled',updated_at=3 WHERE order_id='order1';",/payment_fulfillment_transition_invalid/);
 // D1 must refuse terminal refund/dispute labels without a matching
 // recorded reversal. A direct SQL UPDATE cannot substitute for provider
 // verification, the credit ledger or an operator review.
 run("UPDATE payment_orders SET state='refunded' WHERE order_id='order1';",/sandbox_reversal_evidence_required/);
 run("UPDATE payment_orders SET state='disputed' WHERE order_id='order1';",/sandbox_reversal_evidence_required/);
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

 const key="11111111-1111-4111-8111-111111111111";
 const orderId="bor-sbx-"+key;
 const transactionId="concurrent-transaction";
 const serverKey="SB-Mid-server-synthetic-fixture";
 const merchantId="synthetic-merchant";
 const signatureKey="distinct-synthetic-webhook-key";
 const payload={
  order_id:orderId,
  gross_amount:"10000.00",
  transaction_status:"settlement",
  transaction_id:transactionId,
  merchant_id:merchantId,
  status_code:"200",
  currency:"IDR",
  signature_key:createHash("sha512").update(orderId+"200"+"10000.00"+signatureKey).digest("hex"),
 };
 const {getPlatformProxy}=createRequire(join(temp,"package.json"))("wrangler");
 // The CLI appends v3 to --persist-to; the proxy takes the versioned path.
 const platform=await getPlatformProxy({
  configPath:config,remoteBindings:false,persist:{path:join(persistencePath,"v3")},
 });
 try{
  const db=platform.env.DB;
  const operatorToken="local-synthetic-operator-token-0000";
  const env={
   SANDBOX_DB:db,PAYMENT_SANDBOX_ENABLED:"true",SANDBOX_OPERATOR_TOKEN:operatorToken,
   MIDTRANS_SANDBOX_SERVER_KEY:serverKey,MIDTRANS_SANDBOX_MERCHANT_ID:merchantId,
   MIDTRANS_SANDBOX_SIGNATURE_SECRET_KEY:signatureKey,
  };
  let checkoutCalls=0;
  let statusCalls=0;
  let providerStatus="settlement";
  const providerFetch=async (url,options)=>{
   assert.equal(options.redirect,"manual");
   if (options.method==="POST") {
    checkoutCalls++;
    assert.equal(url,"https://app.sandbox.midtrans.com/snap/v1/transactions");
    assert.deepEqual(JSON.parse(options.body),{transaction_details:{order_id:orderId,gross_amount:10000}});
    return Response.json({redirect_url:"https://app.sandbox.midtrans.com/snap/v4/redirection/11111111-1111-4111-8111-111111111111"},{status:201});
   }
   statusCalls++;
   assert.equal(url,"https://api.sandbox.midtrans.com/v2/"+orderId+"/status");
   return Response.json({...payload,transaction_status:providerStatus});
  };
  const checkout=(token,config=env,checkoutKey=key,fetcher=providerFetch)=>handleSandboxPayment(new Request("https://local.test/checkout",{
   method:"POST",headers:{"Authorization":"Bearer "+token,"Idempotency-Key":checkoutKey},
  }),config,fetcher);
  assert.equal((await checkout(operatorToken,{...env,PAYMENT_SANDBOX_ENABLED:"false"})).status,404);
  assert.equal((await checkout("invalid")).status,401);
  assert.equal(checkoutCalls,0);
  const checkouts=await Promise.all([checkout(operatorToken),checkout(operatorToken)]);
  assert.equal(checkouts.filter(response=>response.status===201).length,1);
  assert.ok(checkouts.every(response=>[200,201,409].includes(response.status)));
  assert.equal(checkoutCalls,1);
  const receipt=await checkouts.find(response=>response.status===201).json();
  assert.equal(receipt.orderId,orderId);
  assert.equal(receipt.amountIdr,10000);
  assert.equal(receipt.redirectUrl,"https://app.sandbox.midtrans.com/snap/v4/redirection/11111111-1111-4111-8111-111111111111");
  const repeated=await checkout(operatorToken);
  assert.equal(repeated.status,200);
  assert.deepEqual(await repeated.json(),receipt);
  assert.equal(checkoutCalls,1);

  const lostKey="33333333-3333-4333-8333-333333333333";
  const lostOrderId="bor-sbx-"+lostKey;
  let attempts=0;
  const lossThenSuccess=async(_url,options)=>{
   assert.equal(JSON.parse(options.body).transaction_details.order_id,lostOrderId);
   if(++attempts===1) throw Error("simulated lost response after Snap created checkout");
   return Response.json({redirect_url:receipt.redirectUrl},{status:201});
  };
  assert.equal((await checkout(operatorToken,env,lostKey,lossThenSuccess)).status,502);
  assert.equal((await checkout(operatorToken,env,lostKey,lossThenSuccess)).status,409);
  await db.prepare("UPDATE sandbox_checkout_receipts SET retry_at=0 WHERE order_id=?").bind(lostOrderId).run();
  const recovered=await checkout(operatorToken,env,lostKey,lossThenSuccess);
  assert.equal(recovered.status,201);
  assert.equal((await recovered.json()).orderId,lostOrderId);
  assert.equal((await checkout(operatorToken,env,lostKey,lossThenSuccess)).status,200);
  assert.equal(attempts,2);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM payment_orders WHERE order_id=?").bind(lostOrderId).first("n"),1);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM credit_ledger WHERE reference_id=?").bind(lostOrderId).first("n"),0);
  const rejectedCheckout=await handleSandboxPayment(new Request("https://local.test/checkout",{
   method:"POST",headers:{"Authorization":"Bearer "+operatorToken,"Idempotency-Key":"22222222-2222-4222-8222-222222222222"},
  }),env,async()=>Response.json({error_messages:["private provider details"]},{status:401}));
  assert.equal(rejectedCheckout.status,502);
  assert.deepEqual(await rejectedCheckout.json(),{
   orderId:"bor-sbx-22222222-2222-4222-8222-222222222222",error:"Sandbox checkout unavailable",diagnostic:"snap_http_401",
  });
  const callback=(body)=>handleSandboxPayment(new Request("https://local.test/webhook",{
   method:"POST",body:JSON.stringify(body),headers:{"Content-Type":"application/json"},
  }),env,providerFetch);
  assert.equal((await callback({...payload,signature_key:"invalid"})).status,401);
  const serverSignature=createHash("sha512").update(orderId+"200"+"10000.00"+serverKey).digest("hex");
  assert.equal((await callback({...payload,signature_key:serverSignature})).status,401);
  const pending=await callback({...payload,transaction_status:"pending"});
  assert.equal(pending.status,200);
  assert.deepEqual(await pending.json(),{outcome:"not_confirmed"});
  assert.equal(statusCalls,0);
  providerStatus="pending";
  const delayed=await callback(payload);
  assert.equal(delayed.status,503);
  assert.deepEqual(await delayed.json(),{outcome:"retry",reason:"status_api_pending"});
  const waitingOrder=await db.prepare("SELECT state, provider_transaction_id FROM payment_orders WHERE order_id=?").bind(orderId).first();
  assert.deepEqual({...waitingOrder},{state:"created",provider_transaction_id:null});
  assert.equal(await db.prepare("SELECT count(*) AS n FROM credit_ledger WHERE reference_id=?").bind(orderId).first("n"),0);
  providerStatus="settlement";
  const responses=await Promise.all(Array.from({length:20},()=>callback(payload)));
  assert.ok(responses.every(response=>response.status===200));
  const results=await Promise.all(responses.map(response=>response.json()));
  assert.equal(results.filter(result=>result.outcome==="fulfilled").length,1);
  assert.equal(results.filter(result=>result.outcome==="unchanged").length,19);
  const order=await db.prepare("SELECT state,provider_transaction_id FROM payment_orders WHERE order_id=?").bind(orderId).first();
  assert.deepEqual({...order},{state:"fulfilled",provider_transaction_id:transactionId});
  const account=await db.prepare("SELECT balance_microcredits FROM credit_accounts WHERE user_id=?").bind("midtrans-sandbox-test").first();
  assert.equal(account?.balance_microcredits,25);
  const ledger=await db.prepare("SELECT delta_microcredits FROM credit_ledger WHERE reference_id=?").bind(orderId).all();
  assert.deepEqual(ledger.results.map(row=>row.delta_microcredits),[25]);
  const reconcile=(token)=>handleSandboxPayment(new Request("https://local.test/reconcile",{
   method:"POST",headers:{"Authorization":"Bearer "+token},body:JSON.stringify({orderId}),
  }),env,providerFetch);
  assert.equal((await reconcile("invalid")).status,401);
  const reconciliation=await reconcile(operatorToken);
  assert.equal(reconciliation.status,200);
  assert.deepEqual(await reconciliation.json(),{orderId,outcome:"unchanged"});
  const recoveredPayload={...payload,order_id:lostOrderId,transaction_id:"recovered-transaction"};
  recoveredPayload.signature_key=createHash("sha512").update(lostOrderId+"200"+"10000.00"+signatureKey).digest("hex");
  const recoveredCallback=()=>handleSandboxPayment(new Request("https://local.test/webhook",{
   method:"POST",body:JSON.stringify(recoveredPayload),
  }),env,async()=>Response.json(recoveredPayload));
  const recoveredOutcomes=await Promise.all([recoveredCallback(),recoveredCallback()]);
  assert.ok(recoveredOutcomes.every(response=>response.status===200));
  assert.deepEqual((await Promise.all(recoveredOutcomes.map(response=>response.json()))).map(reply=>reply.outcome).sort(),["fulfilled","unchanged"]);
  const recoveredLedger=await db.prepare("SELECT delta_microcredits FROM credit_ledger WHERE reference_id=?").bind(lostOrderId).all();
  assert.deepEqual(recoveredLedger.results.map(row=>row.delta_microcredits),[25]);
  assert.equal((await checkout(operatorToken,env,lostKey,lossThenSuccess)).status,409);
  assert.equal(attempts,2);
  const reversalCallback=(event,verified)=>handleSandboxPayment(new Request("https://local.test/webhook",{
   method:"POST",body:JSON.stringify(event),
  }),env,async()=>Response.json(verified));
  const disputed={...payload,transaction_status:"partial_chargeback"};
  const review=await reversalCallback(disputed,disputed);
  assert.equal(review.status,200);
  assert.deepEqual(await review.json(),{outcome:"review_required"});
  const fullRefund={...recoveredPayload,transaction_status:"refund",refund_amount:"10000.00",
   refunds:[{refund_chargeback_id:1,refund_amount:"10000.00",bank_confirmed_at:"2026-11-15 12:00:00"}]};
  const notYet=await reversalCallback(fullRefund,recoveredPayload);
  assert.equal(notYet.status,503);
  const unconfirmed={...fullRefund,refunds:[{...fullRefund.refunds[0],bank_confirmed_at:""}]};
  assert.deepEqual(await (await reversalCallback(fullRefund,unconfirmed)).json(),{outcome:"review_required"});
  const refundResults=await Promise.all([reversalCallback(fullRefund,fullRefund),reversalCallback(fullRefund,fullRefund)]);
  assert.ok(refundResults.every(response=>response.status===200));
  assert.deepEqual((await Promise.all(refundResults.map(response=>response.json()))).map(reply=>reply.outcome).sort(),["reversed","unchanged"]);
  const refundLedger=await db.prepare("SELECT delta_microcredits FROM credit_ledger WHERE reference_id=? ORDER BY delta_microcredits").bind(lostOrderId).all();
  assert.deepEqual(refundLedger.results.map(row=>row.delta_microcredits),[-25,25]);
  assert.equal(await db.prepare("SELECT state FROM payment_orders WHERE order_id=?").bind(lostOrderId).first("state"),"refunded");
  assert.equal(await db.prepare("SELECT balance_microcredits FROM credit_accounts WHERE user_id=?").bind("midtrans-sandbox-test").first("balance_microcredits"),25);
  // A provider-verified dispute AFTER full refund is a fresh operator review.
  // The completed refund must never be double-debited by callback replay.
  const lateChargeback={...fullRefund,transaction_status:"chargeback"};
  for(let replay=0;replay<2;replay++){
    const response=await reversalCallback(lateChargeback,lateChargeback);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{outcome:"review_required"});
  }
  assert.equal(await db.prepare(
    "SELECT COUNT(*) AS n FROM sandbox_payment_reversal_reviews WHERE order_id=? AND provider_status='chargeback'"
  ).bind(lostOrderId).first("n"),1);
  const preserved=await db.prepare(
    "SELECT delta_microcredits FROM credit_ledger WHERE reference_id=? ORDER BY delta_microcredits"
  ).bind(lostOrderId).all();
  assert.deepEqual(preserved.results.map(row=>row.delta_microcredits),[-25,25]);
  assert.equal(await db.prepare("SELECT state FROM payment_orders WHERE order_id=?").bind(lostOrderId).first("state"),"refunded");
  assert.equal(await db.prepare("SELECT balance_microcredits FROM credit_accounts WHERE user_id=?").bind("midtrans-sandbox-test").first("balance_microcredits"),25);
  // Historical sandbox reversal and dispute rows must remain tamper-proof.
  run("UPDATE sandbox_payment_reversals SET outcome='review_required' WHERE order_id='"+lostOrderId+"';",
    /sandbox_reversal_append_only/);
  run("DELETE FROM sandbox_payment_reversals WHERE order_id='"+lostOrderId+"';",
    /sandbox_reversal_delete_forbidden/);
  run("DELETE FROM sandbox_payment_reversal_reviews WHERE order_id='"+lostOrderId+"';",
    /sandbox_reversal_review_delete_forbidden/);
  assert.equal(await db.prepare(
    "SELECT COUNT(*) AS n FROM sandbox_payment_reversal_reviews WHERE order_id=? AND provider_status='chargeback'"
  ).bind(lostOrderId).first("n"),1);
  console.log("PASS: D1 reversal and dispute-review evidence resists UPDATE/DELETE");
  console.log("PASS: post-refund chargeback replay records one review and no double debit");
  console.log("PASS: confirmed Sandbox refund reverses once, unconfirmed refunds and disputes require review");
  console.log("PASS: interrupted and cached checkout retries preserve one order and one credit grant");
  console.log("PASS: pending Status API retries without mutations, then concurrent callbacks and reconciliation grant credit once in D1");
 }finally{await platform.dispose()}
}finally{rmSync(temp,{recursive:true,force:true})}
