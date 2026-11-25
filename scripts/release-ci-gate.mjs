// Draft release guard: validate executed exact-main GitHub Actions evidence before production credentials.
import { pathToFileURL } from "node:url";
export const REQUIRED = {
  "bor-ai-tests.yml": {
    "Unit, syntax, and preview validation": [
      "Run automated tests",
      "Check Worker syntax",
      "Build Worker preview (no deployment)",
      "Build isolated Duitku sandbox preview (no deployment)",
      "Build isolated billing staging preview (no deployment, disabled template)"
    ],
    "Synthetic journal rollback and replay (offline, no Cloudflare)": [
      "Prove rollback, deterministic retry and FK integrity (synthetic only)"
    ],
    "DO to D1 staging recovery (offline contract, no Cloudflare)": [
      "Validate safe synthetic DO-to-D1 rollback and replay",
      "Exercise local Workerd Durable Object plus D1 (NO remote Cloudflare, NO credentials)"
    ]
  },
  "bor-ai-preview-build.yml": {
    "preview-build": [
      "Validate Cloudflare Worker preview build",
      "Validate isolated SQLite journal staging Worker build (no deployment)",
      "Validate isolated private D1-to-R2 backup Workflow (dry-run only, no data access)",
      "Build synthetic enabled-shaped backup release candidate (NO Cloudflare calls)"
    ]
  },
  "bor-ai-e2e.yml": {
    "e2e": [
      "Run npm test",
      "Run npm run test:e2e"
    ]
  },
  "workspace-ui-proof.yml": {
    "Workspace regression and dry-run build": [
      "Run npm test",
      "Run npm run check",
      "Check workspace scripts and unchanged original logo",
      "Bundle only, no deployment"
    ],
    "Workspace browser matrix, synthetic AI only": [
      "Run npm run test:e2e"
    ]
  }
};
export function chooseRun(payload,sha,repo,workflow){
 if(!Array.isArray(payload?.workflow_runs)||!Number.isInteger(payload.total_count)||payload.total_count!==payload.workflow_runs.length||payload.total_count>100)throw Error("Missing or incomplete workflow run inventory");
 const matching=payload.workflow_runs.filter(x=>x.head_sha===sha&&x.head_branch==="main"&&x.repository?.full_name?.toLowerCase()===repo.toLowerCase()&&x.path===`.github/workflows/${workflow}`&&["push","workflow_dispatch"].includes(x.event));
 if(!matching.length)throw Error("No exact-main run for "+workflow);
 if(matching.some(x=>!Number.isSafeInteger(x.run_number)||!Number.isSafeInteger(x.id)||!Number.isSafeInteger(x.run_attempt)||x.run_attempt<1))throw Error("Unverifiable run identity");
 matching.sort((a,b)=>b.run_number-a.run_number);
 if(matching.length>1&&matching[0].run_number===matching[1].run_number)throw Error("Ambiguous latest run");
 const run=matching[0];
 if(run.status!=="completed"||run.conclusion!=="success")throw Error("Latest exact-main run not successful: "+workflow);
 return run;
}
export function verifyJobs(payload,expected,run){
 if(!Array.isArray(payload?.jobs)||!Number.isInteger(payload.total_count)||payload.total_count!==payload.jobs.length||payload.total_count>100)throw Error("Incomplete job inventory");
 const names=Object.keys(expected);
 if(payload.jobs.length!==names.length)throw Error("Unexpected job inventory");
 for(const name of names){
  const matches=payload.jobs.filter(j=>j.name===name);
  if(matches.length!==1)throw Error("Missing or ambiguous job: "+name);
  const j=matches[0];
  if(j.run_id!==run.id||j.head_sha!==run.head_sha||j.status!=="completed"||j.conclusion!=="success"||!Array.isArray(j.steps)||!j.started_at||!j.completed_at)throw Error("Job not executed successfully: "+name);
  for(const step of expected[name]){
   const s=j.steps.filter(x=>x.name===step);
   if(s.length!==1||s[0].status!=="completed"||s[0].conclusion!=="success"||!s[0].started_at||!s[0].completed_at)throw Error("Required step not executed successfully: "+step);
  }
 }
 return true;
}
async function main(){
 const {GITHUB_REPOSITORY:repo,GITHUB_REF:ref,GITHUB_SHA:sha,GH_TOKEN:token}=process.env;
 if(repo?.toLowerCase()!=="muhriskiawan23/ai-command-center"||ref!=="refs/heads/main"||!/^[a-f0-9]{40}$/.test(sha||"")||!token)throw Error("Release CI gate requires exact main and read-only Actions token");
 const root=`https://api.github.com/repos/${repo}`;
 async function get(path){
  const response=await fetch(root+path,{headers:{Authorization:`Bearer ${token}`,Accept:"application/vnd.github+json","X-GitHub-Api-Version":"2022-11-28"},redirect:"error",signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error("GitHub release evidence unavailable: HTTP "+response.status);
  return response.json();
 }
 for(const [workflow,expected] of Object.entries(REQUIRED)){
  const params=new URLSearchParams({branch:"main",head_sha:sha,per_page:"100"});
  const run=chooseRun(await get(`/actions/workflows/${workflow}/runs?${params}`),sha,repo,workflow);
  const jobs=await get(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  verifyJobs(jobs,expected,run);
  console.log(`Verified exact-main executed checks: ${workflow}, run ${run.id}, attempt ${run.run_attempt}`);
 }
 console.log("Release CI gate passed; separate production safety and approval gates still apply.");
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode=1; });
}
