import test from "node:test";
import assert from "node:assert/strict";
import { REQUIRED, chooseRun, verifyJobs, verifyMainHead } from "../scripts/release-ci-gate.mjs";
const repo="muhriskiawan23/ai-command-center",sha="a".repeat(40),workflow="bor-ai-e2e.yml";
const good={id:123,run_number:8,run_attempt:1,head_sha:sha,head_branch:"main",repository:{full_name:repo},path:".github/workflows/"+workflow,event:"workflow_dispatch",status:"completed",conclusion:"success"};
const payload=(...runs)=>({total_count:runs.length,workflow_runs:runs});
const select=p=>chooseRun(p,sha,repo,workflow);
const times={started_at:"2026-11-25T00:00:00Z",completed_at:"2026-11-25T00:01:00Z",status:"completed",conclusion:"success"};
const expected=REQUIRED[workflow];
const job={name:"e2e",run_id:good.id,head_sha:sha,...times,steps:expected.e2e.map(name=>({name,...times}))};
test("exact-main completed run and required executed steps accepted",()=>{assert.equal(select(payload(good)),good);assert.equal(verifyJobs({total_count:1,jobs:[job]},expected,good),true);});
for(const [name,p] of Object.entries({missing:payload(),wrongSha:payload({...good,head_sha:"b".repeat(40)}),wrongBranch:payload({...good,head_branch:"feature"}),prEvent:payload({...good,event:"pull_request"}),latestFailed:payload(good,{...good,id:124,run_number:9,conclusion:"failure"}),queued:payload({...good,status:"queued",conclusion:null}),incomplete:{total_count:2,workflow_runs:[good]},ambiguous:payload(good,{...good,id:124})}))test("reject "+name,()=>assert.throws(()=>select(p)));
for(const [name,j] of Object.entries({missingJobs:[],noSteps:[{...job,steps:[]}],skipStep:[{...job,steps:job.steps.map((s,i)=>i?{...s,conclusion:"skipped"}:s)}],wrongSha:[{...job,head_sha:"b".repeat(40)}],wrongRun:[{...job,run_id:124}]}))test("reject "+name,()=>assert.throws(()=>verifyJobs({total_count:j.length,jobs:j},expected,good)));

test("main head must still equal the dispatch SHA",()=>{assert.equal(verifyMainHead({object:{type:"commit",sha}},sha),true);assert.throws(()=>verifyMainHead({object:{type:"commit",sha:"b".repeat(40)}},sha));assert.throws(()=>verifyMainHead({},sha));assert.throws(()=>verifyMainHead({object:{type:"tag",sha}},sha));});
