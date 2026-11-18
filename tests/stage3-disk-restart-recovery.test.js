// DRAFT-ONLY: test true local SQLite file close/reopen, not remote Cloudflare D1.
// No payments, provider calls, customer data, background jobs or production SQL.
import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {reserveProviderSpend,settleProviderSpend} from "../src/provider-spend-budget.js";
import {reserveCredits} from "../src/credit-ledger.js";
import {appendProviderUsageEvent} from "../src/provider-usage-journal.js";
import {inspectStage3HoldTriage} from "../src/stage3-hold-triage.js";
import {inspectStage3CrossLedgerReconciliation} from "../src/stage3-cross-ledger-reconciliation.js";
import {inspectStage3RecoveryCase} from "../src/stage3-operator-case-triage.js";

const ID="disk-restart-attempt";
const REQ="disk-restart-request";
const USER="disk-restart-user";
const PROVIDER="workers-ai";
const MODEL="@cf/synthetic";
const VERSION="restart-quote-v1";
const LIMIT=8610n;
const NOW=Date.now();
const OLD=NOW-7200_000;
const tariff={approved:true,provider:PROVIDER,model:MODEL,version:VERSION,
  inputRateMicroUsdPerMillion:293000n,
  outputRateMicroUsdPerMillion:2253000n};

function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),"bor-ai-reopen-only-"));
  const path=join(dir,"sandbox.sqlite");
  let sql;
  const open=()=>{
    sql=new DatabaseSync(path);
    sql.exec("PRAGMA foreign_keys=ON");
    return sql;
  };
  open();
  t.after(()=>{
    try{sql?.close();}catch{}
    rmSync(dir,{recursive:true,force:true});
  });
  for(const name of ["0012_credit_ledger","0013_provider_spend_budget",
    "0014_provider_usage_journal","0018_provider_emergency_stop_draft"]){
    sql.exec(readFileSync(new URL("../migrations/"+name+".sql",import.meta.url),"utf8"));
  }
  sql.prepare("INSERT INTO credit_accounts VALUES (?,?,1)").run(USER,50000);
  for(const provider of [PROVIDER,"__global__"])
    sql.prepare("INSERT INTO provider_budget_limits VALUES (?,?,1)").run(provider,50000);
  const stmt=(query,params=[])=>({
    bind(...values){return stmt(query,values);},
    first:async()=>sql.prepare(query).get(...params)??null,
    run:async()=>({meta:{changes:sql.prepare(query).run(...params).changes}})
  });
  const env={DB:{prepare(query){return stmt(query);}}};
  const restart=()=>{
    sql.close();
    sql=undefined;
    open();
    assert.equal(sql.prepare("PRAGMA integrity_check").get().integrity_check,"ok");
    assert.equal(sql.prepare(
      "SELECT COUNT(*) n FROM provider_runtime_controls"
    ).get().n,1,"durable D1 operator control row must survive restart");
  };
  const gate=(enabled,clock)=>sql.prepare(
    "UPDATE provider_runtime_controls SET enabled=?,updated_at=? WHERE control_name='paid_provider_dispatch'"
  ).run(enabled,clock);
  const reserveBudget=(requestId=REQ)=>reserveProviderSpend(env,{
    id:"ai:"+requestId,provider:PROVIDER,model:MODEL,
    maximumMicroUsd:LIMIT,nowMs:OLD
  });
  const reserveWallet=()=>reserveCredits(env,{
    userId:USER,requestId:REQ,amountMicrocredits:LIMIT,now:Math.floor(OLD/1000)
  });
  const journal=(kind)=>appendProviderUsageEvent(env,{
    kind,attemptId:ID,requestId:REQ,provider:PROVIDER,model:MODEL,
    rateVersion:VERSION,nowMs:OLD+1000,...(kind==="usage_measured"
      ?{usage:{prompt_tokens:1000,completion_tokens:100},tariff}:{})
  });
  const balance=()=>sql.prepare(
    "SELECT balance_microcredits AS n FROM credit_accounts WHERE user_id=?"
  ).get(USER).n;
  const state=()=>({
    wallet:sql.prepare("SELECT status FROM credit_reservations WHERE request_id=?").get(REQ)?.status??null,
    budget:sql.prepare("SELECT status FROM provider_budget_reservations WHERE id=?").get("ai:"+REQ)?.status??null,
    rows:sql.prepare("SELECT COUNT(*) n FROM provider_usage_events").get().n
  });
  const inspect=async()=>{
    const writes=sql.prepare("SELECT total_changes() n").get().n;
    const heldBalance=balance(),saved=state();
    const options={nowMs:NOW,staleAfterSeconds:3600};
    const [cross,hold,caseFile]=await Promise.all([
      inspectStage3CrossLedgerReconciliation(env,options),
      inspectStage3HoldTriage(env,options),
      inspectStage3RecoveryCase(env,{
        requestId:REQ,expectedUserId:USER,
        expectedProvider:PROVIDER,expectedModel:MODEL,
        expectedRateVersion:VERSION
      })
    ]);
    assert.equal(sql.prepare("SELECT total_changes() n").get().n,writes);
    assert.equal(balance(),heldBalance);
    assert.deepEqual(state(),saved);
    assert.equal(cross.providerInvoiceVerified,false);
    assert.equal(hold.providerInvoiceVerified,false);
    assert.equal(caseFile.providerInvoiceVerified,false);
    assert.equal(caseFile.operatorActionAuthorized,false);
    for(const report of [cross,hold,caseFile]){
      const output=JSON.stringify(report);
      for(const secret of [USER,REQ,ID,PROVIDER,MODEL])
        assert.equal(output.includes(secret),false,"read-only report leaked fixture identity");
    }
    return {cross,hold,caseFile};
  };
  return {env,restart,gate,reserveBudget,reserveWallet,journal,
    balance,state,inspect,sql:()=>sql};
}

test("file reopen preserves orphan provider hold, global OFF and duplicate prevention",async t=>{
  const x=fixture(t);
  assert.equal((await x.reserveBudget()).ok,false,"fresh D1 must be default OFF");
  x.gate(1,1);
  assert.equal((await x.reserveBudget()).ok,true);
  x.restart();
  assert.equal((await x.reserveBudget()).ok,false,"restart must not erase duplicate request ID");
  const r=await x.inspect();
  assert.equal(r.cross.staleBudgetWithoutWallet,1);
  assert.equal(r.hold.orphanProviderBudgetHolds,1);
  assert.ok(r.caseFile.reasons.includes("wallet_record_missing"));
  assert.equal(x.balance(),50000);
  x.gate(0,2);
  x.restart();
  assert.equal((await x.reserveBudget("after-stop")).ok,false);
  assert.equal(x.state().budget,"reserved");
});
test("file reopen preserves dispatch without outcome as unsettled invoice exposure",async t=>{
  const x=fixture(t);x.gate(1,1);
  assert.equal((await x.reserveBudget()).ok,true);
  assert.equal((await x.reserveWallet()).ok,true);
  assert.equal((await x.journal("dispatched")).ok,true);
  x.restart();
  const r=await x.inspect();
  assert.equal(r.cross.staleUnmeasuredAttempts,1);
  assert.equal(r.hold.staleDispatchesWithoutOutcome,1);
  assert.equal(r.caseFile.reviewClass,"escalate");
  assert.ok(r.caseFile.reasons.includes("unverified_provider_attempt"));
  assert.deepEqual(x.state(),{wallet:"reserved",budget:"reserved",rows:1});
  assert.equal(x.balance(),50000-Number(LIMIT));
});
test("file reopen preserves timeout evidence and rejects implicit zero-cost release",async t=>{
  const x=fixture(t);x.gate(1,1);
  assert.equal((await x.reserveBudget()).ok,true);
  assert.equal((await x.reserveWallet()).ok,true);
  assert.equal((await x.journal("dispatched")).ok,true);
  assert.equal((await x.journal("outcome_unknown")).ok,true);
  x.restart();
  const r=await x.inspect();
  assert.equal(r.cross.unknownUnmeasuredAttempts,1);
  assert.equal(r.hold.unknownProviderHolds,1);
  assert.equal(r.caseFile.reviewClass,"escalate");
  assert.ok(r.caseFile.reasons.includes("unverified_provider_attempt"));
  assert.equal(x.state().budget,"reserved");
  assert.equal(x.state().wallet,"reserved");
  assert.equal((await x.reserveBudget()).ok,false);
});
test("file reopen preserves measured bill and unsettled wallet for human recovery",async t=>{
  const x=fixture(t);x.gate(1,1);
  assert.equal((await x.reserveBudget()).ok,true);
  assert.equal((await x.reserveWallet()).ok,true);
  assert.equal((await x.journal("dispatched")).ok,true);
  assert.equal((await x.journal("usage_measured")).ok,true);
  assert.equal((await settleProviderSpend(x.env,{
    id:"ai:"+REQ,actualMicroUsd:519n,nowMs:NOW
  })).ok,true);
  x.gate(0,2);
  x.restart();
  const r=await x.inspect();
  assert.equal(r.hold.creditFinalizationPending,1);
  assert.equal(r.caseFile.reviewClass,"candidate_wallet_finalization_review");
  assert.equal(x.state().wallet,"reserved");
  assert.equal(x.state().budget,"settled");
  assert.equal(x.balance(),50000-Number(LIMIT));
  assert.equal((await x.reserveBudget("after-stop")).ok,false);
});
test("missing journal schema after restart never becomes a clean recovery report",async t=>{
  const x=fixture(t);x.gate(1,1);
  assert.equal((await x.reserveBudget()).ok,true);
  assert.equal((await x.reserveWallet()).ok,true);
  x.restart();
  x.sql().exec("DROP TABLE provider_usage_events");
  await assert.rejects(x.inspect(),/no such table|snapshot/);
  assert.equal(x.state().budget,"reserved");
  assert.equal(x.state().wallet,"reserved");
});
