import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const runner=readFileSync(
  new URL("./billing/stage3-d1-proof.mjs",import.meta.url),"utf8");

test("remote Stage 3 D1 runner must use preinstalled pinned CLI, not dynamic npx under token",()=>{
  assert.match(runner,/const pinnedVersion="4\.160\.0"/);
  assert.match(runner,/const remoteBin=process\.env\.BOR_AI_STAGE3_WRANGLER_BIN/);
  assert.match(runner,/const executable=remote\?remoteBin:npx/);
  assert.match(runner,/const prefix=remote\?\[\]:\["--yes","wrangler@4"\]/);
  assert.match(runner,/const run=a=>execFileSync\(executable,a/);
  assert.match(runner,/await asyncExec\(executable,args\("--command",s\)/);
  assert.match(runner,/run\(\[\.\.\.prefix,"d1","list","--json"\]\)/);
});
test("remote Wrangler binary and exact version are verified before any D1 inventory or mutation",()=>{
  assert.match(runner,/assert\.equal\(remoteBin,approvedBin/);
  assert.match(runner,/assert\.ok\(existsSync\(remoteBin\)/);
  assert.match(runner,/delete checkEnv\.CLOUDFLARE_API_TOKEN/);
  assert.match(runner,/execFileSync\(remoteBin,\["--version"\]/);
  assert.match(runner,/pinnedVersion\.replaceAll\('\.','\\\\\.'\)/);
  assert.ok(runner.indexOf('if(remote)verifyIdentity()') >
    runner.indexOf('execFileSync(remoteBin,["--version"]'),
    "Never perform a remote inventory request before CLI version verification");
});
test("remote tests cannot silently use production config or delete a remote D1",()=>{
  assert.match(runner,/writeFileSync\(cfg,JSON\.stringify\(/);
  assert.match(runner,/if\(remote\)verifyIdentity\(\)/);
  assert.match(runner,/exact\(0\)/);
  assert.match(runner,/finally\{rmSync\(tmp,\{recursive:true,force:true\}\);\}/);
  assert.doesNotMatch(runner,/d1","(?:delete|create)|d1 (?:delete|create)|migrations apply/);
});
