// FUTURE/INACTIVE Stage 3 migration test against disposable in-memory SQLite.
// Exercises actual unapplied credit ledger + additional append-only triggers.
// Never touches customer balances, any remote D1 or payment gateway.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { reserveCredits, finalizeCredits } from "../src/credit-ledger.js";

const file=name=>readFileSync(new URL("../migrations/"+name,import.meta.url),"utf8");
function fixture(t) {
  const sqlite=new DatabaseSync(":memory:");
  t.after(()=>sqlite.close());
  sqlite.exec(file("0012_credit_ledger.sql"));
  sqlite.exec(file("0015_credit_ledger_append_only.sql"));
  // Re-applying an additive migration is safe for disposable local testing.
  sqlite.exec(file("0015_credit_ledger_append_only.sql"));
  sqlite.prepare(
    "INSERT INTO credit_accounts(user_id,balance_microcredits,updated_at) VALUES (?,?,?)"
  ).run("fake-customer",10000,1);
  const statement=(sql,args=[])=>({
    bind(...next){return statement(sql,next);},
    first:async()=>sqlite.prepare(sql).get(...args)
  });
  const env={DB:{prepare:sql=>statement(sql)}};
  const row=(sql,...args)=>sqlite.prepare(sql).get(...args);
  const ledger=()=>sqlite.prepare(
    "SELECT reason,delta_microcredits,reference_id FROM credit_ledger ORDER BY rowid"
  ).all();
  const balance=()=>row(
    "SELECT balance_microcredits AS amount FROM credit_accounts WHERE user_id='fake-customer'"
  ).amount;
  const reserve=()=>reserveCredits(env,{
    userId:"fake-customer",requestId:"fake-request-1",
    amountMicrocredits:9000n,now:1735000000
  });
  const finalize=()=>finalizeCredits(env,{
    userId:"fake-customer",requestId:"fake-request-1",
    settledMicrocredits:519n,now:1735000001
  });
  return {sqlite,env,row,ledger,balance,reserve,finalize};
}
test("additive migration keeps valid reservation and one exact refund functional",async t=>{
  const x=fixture(t);
  assert.equal((await x.reserve()).ok,true);
  assert.equal(x.balance(),1000);
  assert.equal((await x.finalize()).ok,true);
  assert.equal(x.balance(),9481);
  assert.deepEqual(x.ledger(),[
    {reason:"reserve",delta_microcredits:-9000,reference_id:"fake-request-1"},
    {reason:"refund",delta_microcredits:8481,reference_id:"fake-request-1"}
  ]);
  assert.equal(x.row(
    "SELECT status FROM credit_reservations WHERE request_id='fake-request-1'"
  ).status,"settled");
  assert.equal((await x.finalize()).ok,false);
  assert.equal((await x.reserve()).ok,false);
  assert.equal(x.balance(),9481);
  assert.equal(x.ledger().length,2);
});
test("direct rewrite or deletion of historic customer debit/refund is blocked by SQLite",async t=>{
  const x=fixture(t);await x.reserve();await x.finalize();
  const before=x.ledger();
  for(const statement of [
    "UPDATE credit_ledger SET delta_microcredits=1 WHERE reason='reserve'",
    "UPDATE credit_ledger SET reason='grant' WHERE reason='refund'",
    "DELETE FROM credit_ledger WHERE reason='refund'",
    "DELETE FROM credit_ledger"
  ]) assert.throws(()=>x.sqlite.exec(statement),/credit_ledger_append_only/);
  assert.deepEqual(x.ledger(),before);
  assert.equal(x.balance(),9481);
});
test("unknown-user and insufficient-balance paths still fail closed with append-only triggers",async t=>{
  const x=fixture(t);
  assert.equal((await reserveCredits(x.env,{
    userId:"absent",requestId:"absent-1",amountMicrocredits:1n,now:1735000000
  })).ok,false);
  assert.equal((await reserveCredits(x.env,{
    userId:"fake-customer",requestId:"overspend",
    amountMicrocredits:11000n,now:1735000000
  })).ok,false);
  assert.equal(x.ledger().length,0);
  assert.equal(x.balance(),10000);
});
test("full release of a pre-dispatch reservation appends one immutable full refund",async t=>{
  const x=fixture(t);assert.equal((await x.reserve()).ok,true);
  const result=await finalizeCredits(x.env,{
    userId:"fake-customer",requestId:"fake-request-1",now:1735000001
  });
  assert.equal(result.ok,true);
  assert.equal(x.balance(),10000);
  assert.deepEqual(x.ledger().map(row=>row.delta_microcredits),[-9000,9000]);
  assert.equal((await x.finalize()).ok,false);
  assert.throws(()=>x.sqlite.exec("DELETE FROM credit_ledger"),/append_only/);
});
