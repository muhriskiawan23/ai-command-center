// INACTIVE Stage 3: real LOCAL workerd dispose/recreate with persistent Miniflare
// D1 storage. Uses only disposable files, fictional payment records and mock AI.
// No secrets from CI, production bindings, network calls or remote Cloudflare API.
import assert from "node:assert/strict";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const lockedRequire=createRequire(new URL("./stage3-wrangler-lock/package.json",import.meta.url));
const {build}=lockedRequire("esbuild");
const {Miniflare,convertV4MiniflareOptions}=lockedRequire("miniflare");
const {unstable_splitSqlQuery}=lockedRequire("wrangler");
const root=mkdtempSync(join(tmpdir(),"bor-ai-local-workerd-restart-"));
const operatorKey=randomBytes(32).toString("hex");
const session=randomBytes(32).toString("hex");
const user="workerd-restart-fixture-user";
const now=Math.floor(Date.now()/1000);
const {outputFiles}=await build({
  entryPoints:[fileURLToPath(new URL("../../staging/stage3-worker.js",import.meta.url))],
  bundle:true,format:"esm",platform:"browser",write:false
});
const config=()=>convertV4MiniflareOptions({
  cf:false,
  resourcePersistencePath:root,
  workers:[{
    name:"bor-ai-stage3-persist-only",
    modules:true,script:outputFiles[0].text,
    compatibilityDate:"2026-10-28",
    compatibilityFlags:["enable_request_signal"],
    bindings:{
      STAGE3_MODE:"synthetic",
      STAGE3_OPERATOR_KEY:operatorKey,
      STAGE3_TELEGRAM_WEBHOOK_SECRET:randomBytes(32).toString("hex")
    },
    d1Databases:["STAGE3_DB"],
    outboundService(){throw new Error("All Stage 3 outbound requests disabled");}
  }]
});
let instance;
const launch=async()=>{
  instance=new Miniflare(config());
  return instance.getD1Database("STAGE3_DB");
};
const send=(body,mode)=>{
  const headers={
    "Content-Type":"application/json",
    "Origin":"http://localhost",
    "X-BOR-Stage3-Key":operatorKey,
    "Cookie":"__Host-borai_session="+session
  };
  if(mode)headers["X-BOR-Stage3-Usage"]=mode;
  return instance.dispatchFetch("http://localhost/api/chat",{
    method:"POST",headers,body:JSON.stringify(body)
  });
};
const count=async(db,name,clause="1=1")=>
  (await db.prepare("SELECT COUNT(*) AS n FROM "+name+" WHERE "+clause).first()).n;
try{
  let db=await launch();
  const sql=async source=>db.batch(
    unstable_splitSqlQuery(source).map(statement=>db.prepare(statement))
  );
  const migrations=[
    "0001_auth_and_chat","0002_daily_usage","0003_user_memory",
    "0004_conversation_pinning","0005_conversation_archive",
    "0006_chat_request_idempotency","0008_message_link_sources",
    "0009_public_api_keys","0012_credit_ledger","0013_provider_spend_budget",
    "0014_provider_usage_journal","0016_plan_entitlements_draft",
    "0018_provider_emergency_stop_draft"
  ];
  for(const name of migrations){
    await sql(readFileSync(new URL("../../migrations/"+name+".sql",import.meta.url),"utf8"));
  }
  await sql(`
    CREATE TABLE stage3_staging_requests(id TEXT PRIMARY KEY);
    CREATE TABLE stage3_telegram_accounts(telegram_id INTEGER PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id));
  `);
  await db.prepare("INSERT INTO users (id,email,created_at,updated_at) VALUES (?,?,1,1)")
    .bind(user,"restart@example.test").run();
  await db.prepare(
    "INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,1)"
  ).bind(createHash("sha256").update(session).digest("hex"),user,now+3600).run();
  await db.prepare("INSERT INTO credit_accounts(user_id,balance_microcredits,updated_at) VALUES (?,100000,1)")
    .bind(user).run();
  for(const p of ["stage3-synthetic","__global__"])
    await db.prepare(
      "INSERT INTO provider_budget_limits(provider,daily_cap_micro_usd,updated_at) VALUES (?,100000,1)"
    ).bind(p).run();
  await db.prepare(
    "INSERT INTO verified_plan_payments(order_id,user_id,purchased_tier,verification_status,verified_at,updated_at) "+
    "VALUES ('workerd-restart-proof',?,'basic','verified_paid',?,?)"
  ).bind(user,now-120,now-60).run();
  await db.prepare(
    "INSERT INTO plan_entitlements(user_id,paid_tier,payment_order_id,status,starts_at,ends_at,updated_at) "+
    "VALUES (?,'basic','workerd-restart-proof','active',?,?,?)"
  ).bind(user,now-60,now+3600,now).run();
  assert.equal((await db.prepare(
    "SELECT enabled FROM provider_runtime_controls WHERE control_name='paid_provider_dispatch'"
  ).first()).enabled,0);
  await db.prepare(
    "UPDATE provider_runtime_controls SET enabled=1,updated_at=? WHERE control_name='paid_provider_dispatch'"
  ).bind(now).run();
  const request={message:"Berikan analisis singkat risiko operasional.",requestId:randomUUID()};
  // Fake model returns no verifiable usage: D1 budget and wallet MUST stay
  // reserved across a complete local workerd shutdown and recreation.
  const first=await send(request,"unverified");
  assert.equal(first.status,502);
  assert.equal(await count(db,"provider_budget_reservations","status='reserved'"),1);
  assert.equal(await count(db,"credit_reservations","status='reserved'"),1);
  assert.equal(await count(db,"provider_usage_events","event_kind='usage_unverified'"),1);
  assert.equal(await count(db,"stage3_staging_requests"),1);
  await instance.dispose();instance=undefined;

  db=await launch();
  assert.equal(await count(db,"provider_budget_reservations","status='reserved'"),1);
  assert.equal(await count(db,"credit_reservations","status='reserved'"),1);
  assert.equal(await count(db,"provider_usage_events","event_kind='usage_unverified'"),1);
  assert.equal(await count(db,"stage3_staging_requests"),1);
  const replay=await send(request);
  assert.equal(replay.status,409,"restart must never replay an ambiguous billable request");
  assert.equal(await count(db,"provider_usage_events","event_kind='dispatched'"),1);
  assert.equal(await count(db,"provider_budget_reservations"),1);
  assert.equal(await count(db,"credit_reservations"),1);

  // A fresh stopped runtime must deny new spending while preserving old
  // holds, and the global OFF control must remain durable across a 2nd restart.
  await db.prepare(
    "UPDATE provider_runtime_controls SET enabled=0,updated_at=? WHERE control_name='paid_provider_dispatch'"
  ).bind(now+1).run();
  await instance.dispose();instance=undefined;
  db=await launch();
  assert.equal((await db.prepare(
    "SELECT enabled FROM provider_runtime_controls WHERE control_name='paid_provider_dispatch'"
  ).first()).enabled,0);
  const blocked=await send({message:request.message,requestId:randomUUID()});
  assert.equal(blocked.status,503,"shared D1 emergency OFF survives runtime replacement");
  assert.equal(await count(db,"provider_budget_reservations"),1);
  assert.equal(await count(db,"credit_reservations"),1);
  assert.equal(await count(db,"stage3_staging_requests"),1);
  assert.equal(await count(db,"provider_usage_events","event_kind='usage_measured'"),0);
  console.log("PASS: local workerd replaced twice; persistent D1 holds, unknown usage, idempotency and global OFF survive");
}finally{
  if(instance)await instance.dispose();
  rmSync(root,{recursive:true,force:true});
}
