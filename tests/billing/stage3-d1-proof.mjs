// Inactive Stage 3 SQL proof: disposable local D1 or explicit NEW remote sandbox.
// No provider calls, payments, Worker deployment, production migrations or deletion.
import assert from "node:assert/strict";
import {execFileSync,execFile} from "node:child_process";
import {promisify} from "node:util";
import {randomUUID} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";

const asyncExec=promisify(execFile);
const remote=process.argv[2]==="--remote";
assert.ok(["--remote","--local"].includes(process.argv[2])&&process.argv.length===3);
const production=JSON.parse(readFileSync(resolve("wrangler.jsonc"),"utf8"));
const productionIds=new Set((production.d1_databases||[]).map(x=>x.database_id));
const productionNames=new Set((production.d1_databases||[]).map(x=>x.database_name));
const dbName=remote?process.env.BOR_AI_D1_STAGE3_DB_NAME:"bor-ai-stage3-local-only";
const dbId=remote?process.env.BOR_AI_D1_STAGE3_DB_ID:randomUUID();
if(remote){
  assert.match(dbName||"",/^bor-ai-billing-sbx-stage3-[a-z0-9-]{6,40}$/);
  assert.match(dbId||"",/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.ok(!productionIds.has(dbId)&&!productionNames.has(dbName));
  assert.match(process.env.BOR_AI_D1_SANDBOX_ACCOUNT_ID||"",/^[a-f0-9]{32}$/i);
  assert.ok((process.env.BOR_AI_D1_SANDBOX_TOKEN||"").length>15);
}
const env={...process.env,CLOUDFLARE_SEND_METRICS:"false"};
for(const key of ["CLOUDFLARE_API_TOKEN","CLOUDFLARE_ACCOUNT_ID",
  "CF_API_TOKEN","CLOUDFLARE_GLOBAL_API_KEY","CLOUDFLARE_EMAIL"])delete env[key];
if(remote){
  env.CLOUDFLARE_API_TOKEN=process.env.BOR_AI_D1_SANDBOX_TOKEN;
  env.CLOUDFLARE_ACCOUNT_ID=process.env.BOR_AI_D1_SANDBOX_ACCOUNT_ID;
}
delete env.BOR_AI_D1_SANDBOX_TOKEN;
const tmp=mkdtempSync(join(tmpdir(),"bor-ai-stage3-proof-"));
const cfg=join(tmp,"wrangler.json"),persist=join(tmp,"local");
const npx=process.platform==="win32"?"npx.cmd":"npx";
const migrations=["0012_credit_ledger.sql","0013_provider_spend_budget.sql",
  "0014_provider_usage_journal.sql"].map(f=>resolve("migrations",f));
const args=(type,value)=>["--yes","wrangler@4","d1","execute",dbName,
  remote?"--remote":"--local","--config",cfg,
  ...(remote?[]:["--persist-to",persist]),"--json","--yes",type,value];
const run=a=>execFileSync(npx,a,{
  cwd:process.cwd(),env,encoding:"utf8",timeout:remote?90000:120000,
  maxBuffer:4*1024*1024,stdio:["ignore","pipe","pipe"]
});
function jsonRows(raw){
  const j=JSON.parse(raw);
  assert.ok(Array.isArray(j)&&j.length>0&&j.every(x=>x.success!==false));
  return j.flatMap(x=>x.results||[]);
}
const sql=s=>jsonRows(run(args("--command",s)));
const one=s=>{const r=sql(s);assert.equal(r.length,1);return r[0];};
function reject(s,expected){
  try{sql(s);}catch(error){
    const msg=String(error.stderr||"")+"\n"+String(error.stdout||"");
    assert.ok(msg.includes(expected),"Expected financial SQL guard, not CLI failure");
    return;
  }
  assert.fail("Forbidden financial SQL unexpectedly accepted");
}
async function attempt(s){
  try{
    const r=await asyncExec(npx,args("--command",s),{
      cwd:process.cwd(),env,timeout:remote?90000:120000,maxBuffer:4*1024*1024
    });
    jsonRows(r.stdout);return true;
  }catch(error){
    const out=String(error.stderr||"")+"\n"+String(error.stdout||"");
    if(/global_daily_budget_exceeded_or_unconfigured|provider_daily_budget_exceeded_or_unconfigured|insufficient_credit_balance/.test(out))
      return false;
    throw new Error("Unexpected D1/CLI error during concurrency proof");
  }
}
async function attempts(s){
  if(remote)return Promise.all(s.map(attempt));
  const r=[];for(const q of s)r.push(await attempt(q));return r;
}
const schemaQuery="SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";
const local=new DatabaseSync(":memory:");
const snapshots=[];
try{
  for(const migration of migrations){
    local.exec(readFileSync(migration,"utf8"));
    snapshots.push(local.prepare(schemaQuery).all());
  }
}finally{local.close();}
function norm(row){
  assert.ok(row&&typeof row.type==="string"&&typeof row.name==="string"&&typeof row.sql==="string");
  return [row.type,row.name,row.sql.replace(/\s+/g," ").trim()];
}
function schema(){
  const rows=sql(schemaQuery);
  const internal=rows.filter(x=>x.name==="_cf_KV");
  assert.ok((!remote&&internal.length===0)||
    (remote&&internal.length<=1&&internal.every(x=>x.type==="table")));
  return rows.filter(x=>!(remote&&x.name==="_cf_KV")).map(norm);
}
function exact(stage){
  assert.deepEqual(schema(),stage===0?[]:snapshots[stage-1].map(norm),
    "Unexpected schema/reused database; never mutate remote application DB");
}
const tableStages=[
  ["credit_accounts","credit_ledger","credit_reservations"],
  ["provider_budget_limits","provider_budget_daily","provider_budget_reservations"],
  ["provider_usage_events"]
];
function empty(stage){
  for(const t of tableStages.slice(0,stage).flat())
    assert.equal(one('SELECT COUNT(*) AS n FROM "'+t+'"').n,0,
      "Previous synthetic data detected; NEW sandbox DB required");
}
function verifyIdentity(){
  const list=JSON.parse(run(["--yes","wrangler@4","d1","list","--json"]));
  assert.ok(Array.isArray(list));
  const match=list.find(x=>x.uuid===dbId||x.id===dbId);
  assert.ok(match&&match.name===dbName);
  assert.ok(!productionIds.has(match.uuid||match.id));
}
const now=Math.floor(Date.now()/1000),day=new Date(now*1000).toISOString().slice(0,10);
function budget(request,cost,t=now){
  return "INSERT INTO provider_budget_reservations "+
    "(id,day,provider,model,reserved_micro_usd,status,created_at,updated_at) "+
    "VALUES ('ai:"+request+"','"+day+"','cloudflare-workers-ai','synthetic',"+
    cost+",'reserved',"+t+","+t+")";
}
function wallet(request,user,cost,t=now){
  return "INSERT INTO credit_reservations "+
    "(request_id,user_id,reserved_microcredits,status,created_at,updated_at) "+
    "VALUES ('"+request+"','"+user+"',"+cost+",'reserved',"+t+","+t+")";
}
function event(a,r,kind,measure="NULL,NULL,NULL"){
  return "INSERT INTO provider_usage_events "+
    "(attempt_id,event_kind,request_id,provider,model,rate_version,"+
    "input_tokens,output_tokens,provider_cost_micro_usd,created_at) VALUES ('"+
    a+"','"+kind+"','"+r+"','cloudflare-workers-ai','synthetic','sandbox-v1',"+
    measure+","+now+")";
}
try{
  mkdirSync(persist,{recursive:true});
  writeFileSync(cfg,JSON.stringify({
    name:"bor-ai-stage3-sql-proof-only",compatibility_date:"2026-10-28",
    d1_databases:[{binding:"STAGE3_PROOF_ONLY",database_name:dbName,
      database_id:dbId,...(remote?{}:{preview_database_id:"stage3-local-only"})}]
  }),{mode:0o600});
  if(remote)verifyIdentity();
  // Fail-closed: do not resume partial schema or previous fixture data.
  exact(0);
  for(let i=0;i<migrations.length;i++){
    // Wrangler --file prints progress alongside JSON; verify exit+exact schema.
    run(args("--file",migrations[i]));
    exact(i+1);empty(i+1);
  }
  sql("INSERT INTO credit_accounts VALUES ('fixture',50000,"+now+");"+
    "INSERT INTO credit_accounts VALUES ('parallel',10000,"+now+");"+
    "INSERT INTO provider_budget_limits VALUES ('cloudflare-workers-ai',20000,"+now+");"+
    "INSERT INTO provider_budget_limits VALUES ('__global__',25000,"+now+")");
  sql(budget("measured",8610));sql(wallet("measured","fixture",8610));
  sql(event("attempt-measured","measured","dispatched"));
  reject(event("orphan","wrong-id","usage_measured","1000,100,519"),
    "usage_event_missing_or_mismatched_dispatch");
  sql(event("attempt-measured","measured","usage_measured","1000,100,519"));
  sql("UPDATE provider_budget_reservations SET status='settled',actual_micro_usd=519 WHERE id='ai:measured' AND status='reserved'");
  sql("UPDATE credit_reservations SET status='settled',settled_microcredits=519 WHERE request_id='measured' AND status='reserved'");
  assert.equal(one("SELECT balance_microcredits AS n FROM credit_accounts WHERE user_id='fixture'").n,49481);
  assert.equal(one("SELECT SUM(delta_microcredits) AS n FROM credit_ledger WHERE reference_id='measured'").n,-519);
  reject(budget("measured",8610),"UNIQUE");
  reject(wallet("measured","fixture",8610),"UNIQUE");
  reject(event("attempt-measured","measured","usage_measured","1000,100,519"),"UNIQUE");
  reject("UPDATE provider_usage_events SET provider_cost_micro_usd=0 WHERE event_kind='usage_measured'",
    "usage_event_append_only");
  reject("DELETE FROM provider_usage_events","usage_event_append_only");
  for(const [r,kind] of [["timeout","outcome_unknown"],["unverified","usage_unverified"]]){
    sql(budget(r,8610,now-7200));sql(wallet(r,"fixture",8610,now-7200));
    sql(event("attempt-"+r,r,"dispatched"));sql(event("attempt-"+r,r,kind));
  }
  assert.equal(one("SELECT balance_microcredits AS n FROM credit_accounts WHERE user_id='fixture'").n,32261);
  assert.equal(one("SELECT COUNT(*) AS n FROM credit_reservations WHERE status='reserved'").n,2);
  assert.equal(one("SELECT COUNT(*) AS n FROM provider_budget_reservations WHERE status='reserved'").n,2);
  sql("UPDATE provider_budget_limits SET daily_cap_micro_usd=19539 WHERE provider='__global__'");
  const br=await attempts(Array.from({length:8},(_,i)=>budget("parallel-budget-"+i,600)));
  assert.equal(br.filter(Boolean).length,3,"Global budget cap admission must be atomic");
  const wr=await attempts(Array.from({length:8},(_,i)=>wallet("parallel-wallet-"+i,"parallel",3000)));
  assert.equal(wr.filter(Boolean).length,3,"Wallet debit cap admission must be atomic");
  const f=one("SELECT "+
    "(SELECT spent_micro_usd FROM provider_budget_daily WHERE day='"+day+"' AND provider='__global__') AS spent,"+
    "(SELECT reserved_micro_usd FROM provider_budget_daily WHERE day='"+day+"' AND provider='__global__') AS reserved,"+
    "(SELECT balance_microcredits FROM credit_accounts WHERE user_id='parallel') AS wallet,"+
    "(SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='dispatched') AS dispatched,"+
    "(SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='usage_measured') AS measured,"+
    "(SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='outcome_unknown') AS unknown,"+
    "(SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='usage_unverified') AS unverified");
  assert.deepEqual(f,{spent:519,reserved:19020,wallet:1000,
    dispatched:3,measured:1,unknown:1,unverified:1});
  console.log(JSON.stringify({
    result:"PASS",mode:remote?"remote_disposable_stage3_D1":"local_disposable_stage3_D1",
    checks:["exact_fresh_schema","three_migrations","journal_requires_dispatch",
      "measured_settlement","no_duplicate_charge","append_only_journal",
      "unknown_usage_holds","parallel_global_budget","parallel_wallet_debit"],
    execution:remote?"concurrent_remote":"sequential_local",
    parallelBudgetAllowed:br.filter(Boolean).length,
    parallelWalletAllowed:wr.filter(Boolean).length,
    paidProviderCalls:0,productionDatabaseTouched:false
  }));
}finally{rmSync(tmp,{recursive:true,force:true});}
