// Verify actual prior read-only PLAN evidence; never call Cloudflare or mutate resources.
import {pathToFileURL} from "node:url";
export const POLICIES={
  "image": {
    "workflow": "bor-ai-image-d1-release.yml",
    "job": "image_d1_schema",
    "success": [
      "Refuse unreviewed refs or missing manual approval",
      "Reject payment/synthetic SQL and prove isolated schema",
      "List exact remote migration set using both pinned configs (READ ONLY)",
      "Verify pinned production D1 identity and Time Travel restore bookmark (GET only)",
      "Explain safety status"
    ],
    "skipped": [
      "Apply ONLY reviewed 0012 and 0016 image SQL (EXPLICIT MANUAL APPROVAL)",
      "Check no remaining image migrations after approved apply (READ ONLY)"
    ]
  },
  "backup": {
    "workflow": "bor-ai-private-chat-backup-release.yml",
    "job": "private_backup_release",
    "success": [
      "Reject unreviewed branch, phase and confirmation before any secrets or API calls",
      "Prove isolated config remains OFF in all PLANs and dry-run it",
      "Compile enabled-shaped isolated release candidate using SYNTHETIC inputs only (dry-run)",
      "Report PLAN only, no real backups"
    ],
    "skipped": [
      "Deploy ONLY the isolated backup Worker and Cloudflare Workflow (no export)",
      "Set the restricted export token only on the isolated Worker",
      "Manually trigger exactly one owner-approved Cloudflare backup instance"
    ]
  }
};
export function verifyPlanRun(run,jobs,policy,{repo,sha,runId,currentRunId}){
 if(!/^[a-f0-9]{40}$/.test(sha)||!Number.isSafeInteger(runId)||runId<=0||runId===currentRunId)throw Error("Invalid distinct reviewed PLAN identity");
 if(run?.id!==runId||run.head_sha!==sha||run.head_branch!=="main"||run.repository?.full_name?.toLowerCase()!==repo.toLowerCase()||run.path!==`.github/workflows/${policy.workflow}`||run.event!=="workflow_dispatch"||run.status!=="completed"||run.conclusion!=="success"||!Number.isSafeInteger(run.run_attempt)||run.run_attempt<1)throw Error("Reviewed PLAN run is not successful on exact main SHA");
 if(jobs?.total_count!==1||!Array.isArray(jobs.jobs)||jobs.jobs.length!==1)throw Error("Invalid PLAN job inventory");
 const j=jobs.jobs[0];
 if(j.name!==policy.job||j.run_id!==runId||j.head_sha!==sha||j.status!=="completed"||j.conclusion!=="success"||!j.started_at||!j.completed_at||!Array.isArray(j.steps))throw Error("PLAN job did not execute successfully");
 for(const [names,conclusion] of [[policy.success,"success"],[policy.skipped,"skipped"]]){
  for(const name of names){const a=j.steps.filter(s=>s.name===name);if(a.length!==1||a[0].status!=="completed"||a[0].conclusion!==conclusion||(conclusion==="success"&&(!a[0].started_at||!a[0].completed_at)))throw Error("PLAN step evidence mismatch: "+name);}
 }
 return true;
}
async function main(){
 const {GITHUB_REPOSITORY:repo,GITHUB_SHA:sha,GITHUB_REF:ref,GITHUB_RUN_ID:current,GH_TOKEN:token,BOR_PLAN_RUN_ID:id,BOR_PLAN_KIND:kind}=process.env;
 if(repo!=="muhriskiawan23/ai-command-center"||ref!=="refs/heads/main"||!/^[a-f0-9]{40}$/.test(sha||"")||!token||!/^[1-9]\d*$/.test(id||"")||!/^[1-9]\d*$/.test(current||"")||!Object.hasOwn(POLICIES,kind||""))throw Error("PLAN verification requires exact main, prior run ID and read-only Actions token");
 const runId=Number(id),currentRunId=Number(current);if(!Number.isSafeInteger(runId)||!Number.isSafeInteger(currentRunId)||runId===currentRunId)throw Error("Invalid prior PLAN run ID");
 const root=`https://api.github.com/repos/${repo}`;
 async function get(path){const res=await fetch(root+path,{headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},redirect:"error",signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error("PLAN evidence unavailable: HTTP "+res.status);return res.json();}
 const mainRef=await get("/git/ref/heads/main");if(mainRef?.object?.type!=="commit"||mainRef.object.sha!==sha)throw Error("Main changed since reviewed PLAN");
 const run=await get(`/actions/runs/${runId}`);if(!Number.isSafeInteger(run?.run_attempt)||run.run_attempt<1)throw Error("Invalid PLAN run attempt");
 verifyPlanRun(run,await get(`/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100`),POLICIES[kind],{repo,sha,runId,currentRunId});
 console.log(`Verified executed ${kind} PLAN run ${runId}, attempt ${run.run_attempt}; independent owner approval remains required.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error(e.message);process.exitCode=1});
