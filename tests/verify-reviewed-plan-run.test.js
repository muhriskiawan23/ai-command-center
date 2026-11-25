import test from "node:test";
import assert from "node:assert/strict";
import {POLICIES,verifyPlanRun} from "../scripts/verify-reviewed-plan-run.mjs";
for(const policy of Object.values(POLICIES)){
 const sha="a".repeat(40),repo="muhriskiawan23/ai-command-center",ctx={repo,sha,runId:123,currentRunId:456};
 const run={id:123,head_sha:sha,head_branch:"main",repository:{full_name:repo},path:".github/workflows/"+policy.workflow,event:"workflow_dispatch",status:"completed",conclusion:"success",run_attempt:1};
 const job={name:policy.job,run_id:123,head_sha:sha,status:"completed",conclusion:"success",started_at:"start",completed_at:"end",steps:[...policy.success.map(name=>({name,status:"completed",conclusion:"success",started_at:"start",completed_at:"end"})),...policy.skipped.map(name=>({name,status:"completed",conclusion:"skipped"}))]};
 const jobs={total_count:1,jobs:[job]};
 test(policy.job+" accepts actual completed PLAN only",()=>assert.equal(verifyPlanRun(run,jobs,policy,ctx),true));
 for(const [name,r,j,c] of [["failed",{...run,conclusion:"failure"},jobs,ctx],["wrong sha",{...run,head_sha:"b".repeat(40)},jobs,ctx],["wrong event",{...run,event:"push"},jobs,ctx],["wrong workflow",{...run,path:".github/workflows/other.yml"},jobs,ctx],["same run",run,jobs,{...ctx,currentRunId:123}],["no jobs",run,{total_count:0,jobs:[]},ctx],["no steps",run,{total_count:1,jobs:[{...job,steps:[]}]},ctx],["mutation executed",run,{total_count:1,jobs:[{...job,steps:job.steps.map(s=>s.name===policy.skipped[0]?{...s,conclusion:"success"}:s)}]},ctx]])test(policy.job+" rejects "+name,()=>assert.throws(()=>verifyPlanRun(r,j,policy,c)));
}
