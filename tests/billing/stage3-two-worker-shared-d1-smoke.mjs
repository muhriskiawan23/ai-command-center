// Stage 3 alternative to inaccessible remote Cloudflare staging:
// TWO DISTINCT local workerd Worker scripts, one shared persistent Miniflare D1.
// No production config, account, secrets, network, payments, or paid provider.
// This is NOT a hosted Cloudflare multi-instance test or invoice verification.
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const lockedRequire=createRequire(new URL("./stage3-wrangler-lock/package.json",import.meta.url));
const {build}=lockedRequire("esbuild");
const {Miniflare,convertV4MiniflareOptions}=lockedRequire("miniflare");
const {unstable_splitSqlQuery}=lockedRequire("wrangler");
const root=mkdtempSync(join(tmpdir(),"bor-ai-two-workerd-shared-d1-"));
const operatorKey=randomBytes(32).toString("hex");
const webhookSecret=randomBytes(32).toString("hex");
const session=randomBytes(32).toString("hex");
const user="two-worker-fixture-account";
const now=Math.floor(Date.now()/1000);
const names=["stage3-local-worker-A","stage3-local-worker-B"];
const dbId="bor-ai-disposable-local-shared-"+randomUUID();
const {outputFiles}=await build({
  entryPoints:[fileURLToPath(new URL("../../staging/stage3-worker.js",import.meta.url))],
  bundle:true,format:"esm",platform:"browser",write:false
});
const configure=()=>convertV4MiniflareOptions({
  cf:false,
  resourcePersistencePath:root,
  workers:names.map(name=>({
    name,modules:true,script:outputFiles[0].text,
    compatibilityDate:"2026-10-28",
    compatibilityFlags:["enable_request_signal"],
    bindings:{
      STAGE3_MODE:"synthetic",
      STAGE3_OPERATOR_KEY:operatorKey,
      STAGE3_TELEGRAM_WEBHOOK_SECRET:webhookSecret
    },
    // Explicitly the SAME D1 identity on distinct Worker isolates.
    d1Databases:{STAGE3_DB:dbId},
    outboundService(){throw new Error("Stage 3 local outbound network forbidden");}
  }))
});
let mf;
const launch=async()=>{mf=new Miniflare(configure());return Promise.all([
  mf.getD1Database("STAGE3_DB",names[0]),
  mf.getD1Database("STAGE3_DB",names[1])
]);};
const count=async(db,table,where="1=1")=>
  (await db.prepare("SELECT COUNT(*) AS n FROM "+table+" WHERE "+where).first()).n;
const send=async(workerIndex,body,usage)=>{
  const target=await mf.getWorker(names[workerIndex]);
  const headers={
    "Content-Type":"application/json",
    Origin:"http://localhost",
    "X-BOR-Stage3-Key":operatorKey,
    Cookie:"__Host-borai_session="+session
  };
  if(usage)headers["X-BOR-Stage3-Usage"]=usage;
  return target.fetch("http://localhost/api/chat",{
    method:"POST",headers,body:JSON.stringify(body)
  });
};
const request=()=>({message:"Apa ibu kota Jepang?",requestId:randomUUID()});
const assertState=async(db,expected)=>{
  for(const [table,where,value] of expected){
    assert.equal(await count(db,table,where),value,table+" mismatch: "+where);
  }
};
try {
  let [dbA,dbB]=await launch();
  const sql=async source=>dbA.batch(
    unstable_splitSqlQuery(source).map(s=>dbA.prepare(s))
  );
  const migrations=[
    "0001_auth_and_chat","0002_daily_usage","0003_user_memory",
    "0004_conversation_pinning","0005_conversation_archive",
    "0006_chat_request_idempotency","0008_message_link_sources",
    "0009_public_api_keys","0012_credit_ledger","0013_provider_spend_budget",
    "0014_provider_usage_journal","0016_plan_entitlements_draft",
    "0018_provider_emergency_stop_draft"
  ];
  for(const name of migrations) {
    await sql(readFileSync(new URL("../../migrations/"+name+".sql",import.meta.url),"utf8"));
  }
  await sql(`
    CREATE TABLE stage3_staging_requests(id TEXT PRIMARY KEY);
    CREATE TABLE stage3_telegram_accounts(telegram_id INTEGER PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id));
  `);
  await dbA.prepare("INSERT INTO users(id,email,created_at,updated_at) VALUES (?,?,1,1)")
    .bind(user,"cross-worker@example.test").run();
  await dbA.prepare(
    "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,1)"
  ).bind(createHash("sha256").update(session).digest("hex"),user,now+3600).run();
  await dbA.prepare(
    "INSERT INTO credit_accounts(user_id,balance_microcredits,updated_at) VALUES (?,100000,1)"
  ).bind(user).run();
  for(const provider of ["stage3-synthetic","__global__"]){
    await dbA.prepare(
      "INSERT INTO provider_budget_limits(provider,daily_cap_micro_usd,updated_at) VALUES (?,100000,1)"
    ).bind(provider).run();
  }
  await dbA.prepare(
    "INSERT INTO verified_plan_payments(order_id,user_id,purchased_tier,verification_status,verified_at,updated_at) "+
    "VALUES ('two-worker-fictional-payment',?,'basic','verified_paid',?,?)"
  ).bind(user,now-120,now-60).run();
  await dbA.prepare(
    "INSERT INTO plan_entitlements(user_id,paid_tier,payment_order_id,status,starts_at,ends_at,updated_at) "+
    "VALUES (?,'basic','two-worker-fictional-payment','active',?,?,?)"
  ).bind(user,now-60,now+3600,now).run();
  assert.equal((await dbB.prepare(
    "SELECT enabled FROM provider_runtime_controls WHERE control_name='paid_provider_dispatch'"
  ).first()).enabled,0,"Worker B must see default OFF flag written by A migration");
  const blockedWhileOff=await send(1,request());
  assert.equal(blockedWhileOff.status,503);
  assert.equal(await count(dbA,"stage3_staging_requests"),0);
  await dbA.prepare(
    "UPDATE provider_runtime_controls SET enabled=1,updated_at=? WHERE control_name='paid_provider_dispatch'"
  ).bind(now).run();
  assert.equal((await dbB.prepare(
    "SELECT enabled FROM provider_runtime_controls WHERE control_name='paid_provider_dispatch'"
  ).first()).enabled,1,"Worker B must observe A's shared D1 OFF->ON");

  // Concurrent duplicate requests cross two distinct workerd scripts:
  // at most one provider dispatch and at most one credit/budget reservation.
  const uncertainRequest=request();
  const two=await Promise.all([
    send(0,uncertainRequest,"unverified"),send(1,uncertainRequest,"unverified")
  ]);
  assert.deepEqual(two.map(r=>r.status).sort((a,b)=>a-b),[409,502],
    "Concurrent duplicate must have one rejected replay and one unknown cost");
  for(const db of [dbA,dbB]){
    await assertState(db,[
      ["stage3_staging_requests","1=1",1],
      ["provider_usage_events","event_kind='dispatched'",1],
      ["provider_usage_events","event_kind='usage_unverified'",1],
      ["credit_reservations","status='reserved'",1],
      ["provider_budget_reservations","status='reserved'",1],
      ["provider_usage_events","event_kind='usage_measured'",0]
    ]);
  }
  assert.equal((await send(1,uncertainRequest)).status,409,
    "Different Worker must not repeat ambiguous upstream billing");
  // A concurrent measured request is charged exactly once, regardless of
  // response replay, with no duplicate finalized credits or provider spend.
  const measuredRequest=request();
  const measured=await Promise.all([
    send(0,measuredRequest),send(1,measuredRequest)
  ]);
  assert.ok(measured.every(r=>[200,409].includes(r.status)));
  const good=await Promise.all(measured.filter(r=>r.status===200).map(r=>r.json()));
  assert.equal(good.filter(x=>x.saved===true&&x.replayed!==true).length,1);
  await assertState(dbB,[
    ["stage3_staging_requests","1=1",2],
    ["provider_usage_events","event_kind='dispatched'",2],
    ["provider_usage_events","event_kind='usage_measured'",1],
    ["credit_reservations","status='settled'",1],
    ["credit_reservations","status='reserved'",1],
    ["provider_budget_reservations","status='settled'",1],
    ["provider_budget_reservations","status='reserved'",1]
  ]);
  // An uncertain upstream call has already DEBITED the maximum reserve
  // from available credits, but it is NOT a finalized consumer charge.
  // Check available + still-held credits + finalized spend == initial wallet.
  const unsettledReserve=(await dbB.prepare(
    "SELECT COALESCE(SUM(reserved_microcredits),0) AS n FROM credit_reservations WHERE status='reserved'"
  ).first()).n;
  assert.ok(unsettledReserve>0,"Unknown upstream cost must retain a positive wallet hold");
  const available=(await dbA.prepare(
    "SELECT balance_microcredits AS n FROM credit_accounts WHERE user_id=?"
  ).bind(user).first()).n;
  assert.equal(available+unsettledReserve+519,100000,
    "Available wallet plus unresolved hold plus one measured charge must conserve total credits");
  const netLedger=(await dbB.prepare(
    "SELECT COALESCE(SUM(delta_microcredits),0) AS n FROM credit_ledger"
  ).first()).n;
  assert.equal(netLedger,-519-unsettledReserve,
    "Append-only ledger must include the unknown reserve debit, not classify it as a settled charge");

  // Completely dispose/recreate BOTH local Worker isolates, retaining the
  // single persisted D1 identity across a new workerd process.
  await mf.dispose();mf=undefined;
  [dbA,dbB]=await launch();
  await assertState(dbB,[
    ["stage3_staging_requests","1=1",2],
    ["provider_usage_events","event_kind='usage_unverified'",1],
    ["credit_reservations","status='reserved'",1],
    ["provider_budget_reservations","status='reserved'",1]
  ]);
  assert.equal((await send(1,uncertainRequest)).status,409);
  assert.equal(await count(dbA,"provider_usage_events","event_kind='dispatched'"),2);
  await dbA.prepare(
    "UPDATE provider_runtime_controls SET enabled=0,updated_at=? WHERE control_name='paid_provider_dispatch'"
  ).bind(now+1).run();
  const preOff={
    claims:await count(dbB,"stage3_staging_requests"),
    budgets:await count(dbB,"provider_budget_reservations"),
    credits:await count(dbB,"credit_reservations"),
    journal:await count(dbB,"provider_usage_events")
  };
  const denied=await Promise.all([send(0,request()),send(1,request())]);
  assert.deepEqual(denied.map(x=>x.status),[503,503],
    "Global shared D1 OFF must block both Worker isolates");
  assert.equal(await count(dbB,"stage3_staging_requests"),preOff.claims);
  assert.equal(await count(dbB,"provider_budget_reservations"),preOff.budgets);
  assert.equal(await count(dbB,"credit_reservations"),preOff.credits);
  assert.equal(await count(dbB,"provider_usage_events"),preOff.journal);
  // Another full runtime replacement must preserve OFF and outstanding holds.
  await mf.dispose();mf=undefined;
  [dbA,dbB]=await launch();
  assert.equal((await dbB.prepare(
    "SELECT enabled FROM provider_runtime_controls WHERE control_name='paid_provider_dispatch'"
  ).first()).enabled,0);
  assert.equal((await send(0,request())).status,503);
  assert.equal(await count(dbA,"credit_reservations","status='reserved'"),1);
  assert.equal(await count(dbB,"provider_budget_reservations","status='reserved'"),1);
  console.log(JSON.stringify({
    result:"PASS",
    scope:"TWO_DISTINCT_LOCAL_WORKER_ISOLATES_SHARED_PERSISTENT_D1_ONLY",
    distinctWorkerScripts:2,
    durableRuntimeReplacements:2,
    concurrentUnknownAttempts:1,
    concurrentMeasuredDebits:1,
    independentRemoteWorkersVerified:false,
    authenticProviderStatementsVerified:false,
    paidProviderCalls:0,
    productionDatabaseTouched:false
  }));
} finally {
  if(mf)await mf.dispose();
  rmSync(root,{recursive:true,force:true});
}
