// Regression tests for the PROPOSED (unmerged, manual-only) Stage 3 remote
// D1 dispatcher. Pure static checks: NO Cloudflare access or remote SQL.
// Independent review and founder approval remain required for any real run.
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const file=new URL("../.github/workflows/bor-ai-stage3-sandbox-dispatch.yml",import.meta.url);
const yaml=readFileSync(file,"utf8");
function topSection(name){
  const lines=yaml.split("\n"),start=lines.indexOf(name+":");
  assert.ok(start>=0,"Missing top-level "+name);
  const end=lines.findIndex((line,index)=>index>start&&/^[A-Za-z][A-Za-z0-9_-]*:/.test(line));
  return lines.slice(start+1,end<0?undefined:end).join("\n");
}
test("Stage 3 sandbox dispatcher must be EXPLICITLY manual-only with no input override",()=>{
  const triggers=topSection("on").split("\n").map(x=>x.trim()).filter(Boolean);
  assert.deepEqual(triggers,["workflow_dispatch:"]);
  assert.equal((yaml.match(/^on:$/gm)||[]).length,1);
  assert.doesNotMatch(yaml,/^\s{2}(push|pull_request|schedule|workflow_run|repository_dispatch):/m);
});
test("GitHub token and job privileges are read-only, bounded, and sandbox isolated",()=>{
  assert.deepEqual(topSection("permissions").split("\n").map(x=>x.trim()).filter(Boolean),["contents: read"]);
  const jobs=topSection("jobs").match(/^  [\w-]+:\s*$/gm)||[];
  assert.deepEqual(jobs,["  stage3-remote-d1:"]);
  assert.match(yaml,/^    environment: billing-sandbox$/m);
  assert.match(yaml,/^    timeout-minutes: 35$/m);
  assert.match(topSection("concurrency"),/^  group: bor-ai-stage3-remote-d1-sandbox$/m);
  assert.match(topSection("concurrency"),/^  cancel-in-progress: false$/m);
  assert.doesNotMatch(yaml,/^\s+(id-token|actions|deployments|packages|issues|pull-requests):\s*write$/mi);
});
test("only the main dispatcher may check out one immutable reviewed test commit",()=>{
  const envPin=yaml.match(/^      PINNED_TEST_SHA: '([a-f0-9]{40})'$/m)?.[1];
  const checkoutPin=yaml.match(/^          ref: ([a-f0-9]{40})$/m)?.[1];
  assert.ok(envPin,"No immutable pinned commit in job environment");
  assert.equal(checkoutPin,envPin,"Checkout and verified test SHA mismatch");
  assert.match(yaml,/test "\$GITHUB_REF" = 'refs\/heads\/main'/);
  assert.match(yaml,/ACTUAL="\$\(git rev-parse HEAD\)"/);
  assert.match(yaml,/test "\$ACTUAL" = "\$PINNED_TEST_SHA"/);
  assert.equal((yaml.match(/^          ref:/gm)||[]).length,1);
  assert.match(yaml,/^          persist-credentials: false$/m,
    "Do not persist GitHub credentials into a test workspace that runs pinned code");
});
test("only allowed D1 sandbox token, account and separate Stage 2/3 identity vars appear",()=>{
  const secretRefs=[...yaml.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(x=>x[1]);
  const vars=[...yaml.matchAll(/vars\.([A-Z0-9_]+)/g)].map(x=>x[1]);
  assert.deepEqual(secretRefs,["BOR_AI_D1_SANDBOX_TOKEN"]);
  assert.deepEqual(vars,[
    "BOR_AI_D1_SANDBOX_ACCOUNT_ID",
    "BOR_AI_D1_STAGE3_DB_NAME","BOR_AI_D1_STAGE3_DB_ID",
    "BOR_AI_D1_SANDBOX_DB_NAME","BOR_AI_D1_SANDBOX_DB_ID"
  ]);
  assert.match(yaml,/^      CLOUDFLARE_SEND_METRICS: 'false'$/m);
  assert.doesNotMatch(yaml,/secrets\.(?:MIDTRANS|OPENAI|TAVILY|CLOUDFLARE_API_TOKEN)/i);
});
test("remote command is test-only; no deploy, paid AI, or DB destroy command",()=>{
  const remoteCommands=yaml.split("\n").filter(x=>/^\s+run: .*--remote\s*$/.test(x));
  assert.deepEqual(remoteCommands,[
    "        run: node tests/billing/stage3-d1-proof.mjs --remote"
  ]);
  assert.doesNotMatch(yaml,/^\s+run: .*\b(?:deploy|migrations apply|d1 delete|d1 create|cloudflare workers deploy)\b/mi);
  assert.doesNotMatch(yaml,/^\s+run: .*\b(?:curl|wget|powershell|bash -c|eval)\b/mi);
  assert.match(yaml,/^      - name: Install locked dependencies\n        run: npm ci$/m);
});

test("Cloudflare token and database identifiers are scoped ONLY to the remote proof step",()=>{
  const heading="      - name: Verify exact NEW remote Stage 3 database and synthetic financial invariants";
  const start=yaml.indexOf(heading);
  assert.ok(start>0,"Expected bounded D1 remote proof step");
  const after=yaml.indexOf("\n      - name:",start+heading.length);
  assert.ok(after>start,"Expected separate follow-up step");
  const before=yaml.slice(0,start);
  const proof=yaml.slice(start,after);
  const tail=yaml.slice(after);
  assert.doesNotMatch(before,/\$\{\{\s*(?:secrets|vars)\./,
    "Checkout and npm installation must not inherit D1 credentials");
  assert.doesNotMatch(tail,/\$\{\{\s*(?:secrets|vars)\./,
    "Later reporting must not inherit D1 credentials");
  assert.match(proof,/^        env:$/m);
  assert.match(proof,/^          BOR_AI_D1_SANDBOX_TOKEN: \$\{\{ secrets\.BOR_AI_D1_SANDBOX_TOKEN \}\}$/m);
  assert.match(proof,/^          BOR_AI_D1_STAGE3_DB_ID: \$\{\{ vars\.BOR_AI_D1_STAGE3_DB_ID \}\}$/m);
  assert.match(proof,/^        run: node tests\/billing\/stage3-d1-proof\.mjs --remote$/m);
  assert.equal((yaml.match(/BOR_AI_D1_SANDBOX_TOKEN:/g)||[]).length,1);
});
