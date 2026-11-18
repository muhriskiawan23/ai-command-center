// Draft-only proof. Fresh in-memory SQLite; no operator API, live payment,
// Cloudflare binding, remote D1 migration or network call is involved.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { reserveProviderSpend, settleProviderSpend } from "../src/provider-spend-budget.js";

function setup(t){
  const db=new DatabaseSync(":memory:");
  t.after(()=>db.close());
  for(const name of ["0013_provider_spend_budget","0018_provider_emergency_stop_draft"]){
    db.exec(readFileSync(new URL("../migrations/"+name+".sql",import.meta.url),"utf8"));
  }
  db.exec("INSERT INTO provider_budget_limits VALUES ('workers-ai',10000,1)");
  db.exec("INSERT INTO provider_budget_limits VALUES ('__global__',10000,1)");
  const env={DB:{
    prepare(sql){
      return {
        bind(...params){
          return {first:async()=>db.prepare(sql).get(...params)};
        }
      };
    }
  }};
  const set=(enabled,clock)=>db.prepare(
    "UPDATE provider_runtime_controls SET enabled=?,updated_at=? WHERE control_name='paid_provider_dispatch'"
  ).run(enabled,clock);
  const reserve=(id)=>reserveProviderSpend(env,{
    id,provider:"workers-ai",model:"@cf/synthetic",
    maximumMicroUsd:1000n,nowMs:1735000000000
  });
  const spent=()=>db.prepare(
    "SELECT COALESCE(SUM(reserved_micro_usd+spent_micro_usd),0) AS amount FROM provider_budget_daily"
  ).get().amount;
  return {db,env,reserve,set,spent};
}

test("global D1 paid-provider gate defaults OFF and rejects spend atomically",async t=>{
  const x=setup(t);
  assert.equal(x.db.prepare("SELECT enabled FROM provider_runtime_controls").get().enabled,0);
  assert.equal((await x.reserve("ai:blocked")).ok,false);
  assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM provider_budget_reservations").get().n,0);
  assert.equal(x.spent(),0);
});
test("explicitly enabled gate permits one reservation, OFF blocks the next without releasing old holds",async t=>{
  const x=setup(t);
  assert.equal(x.set(1,1).changes,1);
  assert.equal((await x.reserve("ai:allowed")).ok,true);
  assert.equal(x.spent(),2000); // provider and global daily accounting
  assert.equal(x.set(0,2).changes,1);
  assert.equal((await x.reserve("ai:blocked-again")).ok,false);
  assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM provider_budget_reservations").get().n,1);
  assert.equal(x.spent(),2000);
  assert.equal((await settleProviderSpend(x.env,{
    id:"ai:allowed",actualMicroUsd:519n,nowMs:1735000001000
  })).ok,true);
  assert.equal(x.spent(),1038); // settled evidence remains available while paused
});
test("direct SQL inserts and media-provider reservations also fail under the same shared OFF gate",async t=>{
  const x=setup(t);
  assert.throws(()=>x.db.prepare(
    "INSERT INTO provider_budget_reservations "+
    "(id,day,provider,model,reserved_micro_usd,status,created_at,updated_at) "+
    "VALUES ('media:direct','2026-11-18','workers-ai','@cf/synthetic',1000,'reserved',1,1)"
  ).run(),/paid_provider_dispatch_disabled/);
  assert.equal(x.spent(),0);
  assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM provider_budget_reservations").get().n,0);
});
test("invalid, absent and corrupt global control states fail closed without spending",async t=>{
  const x=setup(t);
  assert.throws(()=>x.set(2,1),/CHECK/);
  assert.throws(()=>x.db.exec("DELETE FROM provider_runtime_controls"),/provider_runtime_control_delete_forbidden/);
  assert.throws(()=>x.db.exec("UPDATE provider_runtime_controls SET updated_at=-1"),/CHECK/);
  assert.equal((await x.reserve("ai:off")).ok,false);
  x.db.exec("DROP TABLE provider_runtime_controls");
  assert.equal((await x.reserve("ai:missing-table")).ok,false);
  assert.equal(x.spent(),0);
});
test("a paused gate can be reenabled in disposable D1 without changing historical reservations",async t=>{
  const x=setup(t);
  x.set(1,1);
  assert.equal((await x.reserve("ai:first")).ok,true);
  x.set(0,2);
  assert.equal((await x.reserve("ai:second")).ok,false);
  x.set(1,3);
  assert.equal((await x.reserve("ai:second")).ok,true);
  assert.equal(x.db.prepare("SELECT COUNT(*) AS n FROM provider_budget_reservations").get().n,2);
});
