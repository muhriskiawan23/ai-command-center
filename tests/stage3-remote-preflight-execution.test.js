import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {join} from "node:path";

const runner=new URL("./billing/stage3-d1-proof.mjs",import.meta.url);
const env={
  ...process.env,
  BOR_AI_D1_STAGE3_DB_NAME:"bor-ai-billing-sbx-stage3-proof-01",
  BOR_AI_D1_STAGE3_DB_ID:"11111111-1111-4111-8111-111111111111",
  BOR_AI_D1_SANDBOX_ACCOUNT_ID:"1234567890abcdef1234567890abcdef",
  BOR_AI_D1_SANDBOX_TOKEN:"synthetic-token-no-provider-access",
  BOR_AI_D1_SANDBOX_DB_NAME:"bor-ai-billing-sbx-stage2-clean-01",
  BOR_AI_D1_SANDBOX_DB_ID:"02907886-d55c-4194-9c45-39996a834c6c",
  RUNNER_TEMP:"/tmp/bor-ai-stage3-no-real-cli-synthetic",
  BOR_AI_STAGE3_WRANGLER_BIN:
    "/tmp/bor-ai-stage3-no-real-cli-synthetic/stage3-wrangler/node_modules/.bin/wrangler"
};
function aborted(overrides,reason){
  const result=spawnSync(process.execPath,[runner.pathname,"--remote"],{
    cwd:process.cwd(),env:{...env,...overrides},
    encoding:"utf8",timeout:8000
  });
  assert.notEqual(result.status,0,"Unsafe remote proof must abort before D1 SQL");
  assert.match(result.stderr,reason);
  assert.equal(result.stdout.includes("remote_disposable_stage3_D1"),false);
  assert.equal(result.stderr.includes(env.BOR_AI_D1_SANDBOX_TOKEN),false);
}
test("remote runner denies missing prior sandbox identity BEFORE spawning CLI",()=>{
  aborted({BOR_AI_D1_SANDBOX_DB_NAME:""},/Existing Stage 2 sandbox name required/);
  aborted({BOR_AI_D1_SANDBOX_DB_ID:""},/Existing Stage 2 sandbox UUID required/);
});
test("remote runner denies unapproved target UUID BEFORE spawning CLI",()=>{
  aborted({BOR_AI_D1_STAGE3_DB_ID:env.BOR_AI_D1_SANDBOX_DB_ID},
    /Refusing to reuse an existing Stage 2 sandbox database/);
});
test("remote runner refuses missing preinstalled CLI; no npx/npm fallback with token",()=>{
  aborted({},/Preinstalled remote Wrangler CLI missing/);
});
test("remote runner denies unapproved binary path before any D1 action",()=>{
  aborted({
    BOR_AI_STAGE3_WRANGLER_BIN:join(env.RUNNER_TEMP,"unreviewed-wrapper")
  },/Remote CLI path must be the preinstalled isolated reviewed Wrangler/);
});
