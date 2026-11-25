import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
test("production release verifies planned and generated text policy and refuses stale main before promotion",()=>{
 const w=source(".github/workflows/bor-ai-deploy.yml");
 const p=w.indexOf("verifyPlannedTextPolicy(config,textPolicy,process.env)");
 const m=w.indexOf("- name: Apply D1 migrations");
 const f=w.indexOf("verifyCandidateTextPolicy(config,JSON.parse(process.env.BOR_EXPECTED_TEXT_POLICY))");
 const u=w.indexOf("wrangler versions upload");
 const h=w.indexOf('current_main="$(git ls-remote origin refs/heads/main | cut -f1)"');
 const deploy=w.indexOf('wrangler versions deploy "$version_id@100"');
 assert.ok(p>0&&m>p&&f>p&&u>f&&h>u&&deploy>h);
 assert.match(w,/refuse stale promotion/);
});
test("integrated CI-only pipeline is opt-in, full-matrix, no remote deploy",()=>{
 const s=source("scripts/run-integrated-release-ci-only.sh");
 assert.match(s,/set -euo pipefail/);
 assert.ok(s.includes('"${BOR_E2E_CI_ONLY:-}" != "1"'));
 assert.match(s,/npm ci\nnpm test\nnpm run check\nnpm run preview\nBOR_E2E_CI_ONLY=1 bash scripts\/run-browser-e2e-ci-only\.sh\s*$/);
 assert.doesNotMatch(s,/wrangler\s+(?:deploy|d1|versions)|--project|--pass-with-no-tests/);
});
