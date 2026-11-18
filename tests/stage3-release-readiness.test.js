import test from "node:test";
import assert from "node:assert/strict";
import {inspectStage3ReleaseReadiness} from "../src/stage3-release-readiness.js";

const SHA="a".repeat(40);
const expectedHeadSha=SHA;
const evaluate=checked=>inspectStage3ReleaseReadiness({headSha:SHA,expectedHeadSha,checked});
test("no evidence is NO_GO with no financial or deployment authorization",()=>{
  const r=evaluate({});
  assert.equal(r.state,"NO_GO");
  assert.equal(r.checkedCount,0);
  assert.equal(r.missing.length,r.requiredCount);
  assert.equal(r.canDeployProduction,false);
  assert.equal(r.canEnablePaidProvider,false);
  assert.equal(r.canChargeCustomers,false);
  assert.equal(r.canMergeFinancialBranches,false);
});
test("matching exact head and partial local proof cannot satisfy remote staging or provider invoice",()=>{
  const r=evaluate({localRestart:true,localRegression:true,operatorDualControl:true});
  assert.equal(r.state,"NO_GO");
  assert.equal(r.checkedCount,3);
  for(const key of ["hostedMultiInstance","providerSource","merchantLifecycle","independentSecurity"])
    assert.ok(r.missing.includes(key));
});
test("truthy strings, inherited flags and mismatched head cannot count as proof",()=>{
  const fake=Object.create({hostedMultiInstance:true});
  fake.localRegression="true";
  fake.localRestart=1;
  const r=evaluate(fake);
  assert.equal(r.checkedCount,0);
  const mismatch=inspectStage3ReleaseReadiness({
    headSha:"b".repeat(40),expectedHeadSha:SHA,
    checked:Object.fromEntries(r.gates.map(g=>[g.key,true]))
  });
  assert.equal(mismatch.checkedCount,0);
  assert.equal(mismatch.state,"NO_GO");
});
test("even all manually checked booleans only request independent review, NEVER launch",()=>{
  const empty=evaluate({});
  const r=evaluate(Object.fromEntries(empty.gates.map(g=>[g.key,true])));
  assert.equal(r.state,"INDEPENDENT_RELEASE_REVIEW_REQUIRED");
  assert.equal(r.checkedCount,r.requiredCount);
  assert.equal(r.authenticatedEvidenceVerified,false);
  assert.equal(r.canDeployProduction,false);
  assert.equal(r.canEnablePaidProvider,false);
  assert.equal(r.canChargeCustomers,false);
});
test("invalid or unbounded audit inputs fail closed",()=>{
  for(const args of [
    {headSha:"missing",expectedHeadSha:SHA,checked:{}},
    {headSha:SHA,expectedHeadSha:"invalid",checked:{}},
    {headSha:SHA,expectedHeadSha:SHA,checked:null},
    {headSha:SHA,expectedHeadSha:SHA,checked:[]}
  ])assert.throws(()=>inspectStage3ReleaseReadiness(args),TypeError);
});
