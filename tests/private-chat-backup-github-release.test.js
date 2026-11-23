import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const yaml=readFileSync('.github/workflows/bor-ai-private-chat-backup-release.yml','utf8');

test('private D1 backup release is manual only, defaults to non-writing PLAN with production lock',()=>{
  assert.match(yaml,/workflow_dispatch:/);
  assert.match(yaml,/options: \[plan, preflight, deploy, trigger\]/);
  assert.match(yaml,/default: plan/);
  assert.match(yaml,/environment: production/);
  assert.match(yaml,/group: bor-ai-production-deploy/);
  assert.match(yaml,/cancel-in-progress: false/);
  assert.match(yaml,/refs\/heads\/main/);
  assert.match(yaml,/reviewed_main_sha:/);
  assert.match(yaml,/\"\$SHA_APPROVED\" == \"\$GITHUB_SHA\"/);
  assert.match(yaml,/git ls-remote origin refs\/heads\/main/);
  assert.doesNotMatch(yaml,/^\s+(?:push|pull_request|schedule):/m);
});
test('deploy can only target separate backup Worker after private bucket GET audit, no auto provisioning',()=>{
  const gate=yaml.indexOf('- name: Verify existing dedicated R2 backup bucket is private (GET only)');
  const deploy=yaml.indexOf('- name: Deploy ONLY the isolated backup Worker and Cloudflare Workflow');
  const secret=yaml.indexOf('- name: Set the restricted export token only on the isolated Worker');
  assert.ok(gate>0&&deploy>gate&&secret>deploy);
  assert.match(yaml,/DEPLOY_BOR_PRIVATE_CHAT_BACKUP/);
  assert.match(yaml,/DEPLOY_ISOLATED_BOR_CHAT_PRIVATE_BACKUP_WORKFLOW/);
  assert.match(yaml,/BOR_PRIVATE_BACKUP_BUCKET_REVIEWED: bor-ai-chat-private-backups/);
  assert.match(yaml,/BOR_PRIVATE_BACKUP_SIGNED_HOST: \$\{\{ inputs\.signed_host \}\}/);
  assert.match(yaml,/secrets\.CLOUDFLARE_BACKUP_DEPLOY_TOKEN/);
  assert.match(yaml,/secrets\.BOR_PRIVATE_D1_EXPORT_TOKEN/);
  assert.match(yaml,/wrangler@4\.165\.0 deploy --experimental-auto-create=false/);
  assert.match(yaml,/wrangler@4\.165\.0 secret put BOR_D1_EXPORT_TOKEN/);
  assert.doesNotMatch(yaml,/wrangler\.jsonc\s*$/m);
  assert.doesNotMatch(yaml,/d1 migrations apply|d1 time-travel restore|d1 backup restore/);
  assert.doesNotMatch(yaml,/r2 bucket create|r2 object put|queue create|OPENAI_API_KEY/);
});
test('trigger has separate low-traffic owner consent and never logs SQL, R2 object or signed download URL',()=>{
  const trigger=yaml.indexOf('- name: Manually trigger exactly one owner-approved Cloudflare backup instance');
  const plan=yaml.indexOf('- name: Report PLAN only, no real backups');
  assert.ok(trigger>0&&plan>trigger);
  const run=yaml.slice(trigger,plan);
  assert.match(yaml,/TRIGGER_BOR_PRIVATE_CHAT_BACKUP/);
  assert.match(yaml,/I_ACCEPT_BRIEF_D1_EXPORT_UNAVAILABILITY/);
  assert.match(yaml,/if: \$\{\{ inputs\.phase == 'trigger' \}\}/);
  assert.match(run,/wrangler@4\.165\.0 workflows trigger bor-ai-chat-private-backup-v1/);
  assert.match(run,/owner-approved-private-backup/);
  assert.match(run,/--id "\$instance" > "\$RUNNER_TEMP\/bor-ai-backup-trigger\.txt"/);
  assert.match(run,/Trigger is not backup completion or independently proven recovery/);
  assert.doesNotMatch(run,/cat "\$RUNNER_TEMP|d1 export|\.sql|R2_BUCKET\.get\(/);
});
test('safe-off PLAN dry-run explicitly checks production resources remain isolated',()=>{
  assert.match(yaml,/node scripts\/prepare-chat-private-backup-staging\.mjs/);
  assert.match(yaml,/cfg\.vars\.BOR_BACKUP_ENABLED!=='false'/);
  assert.match(yaml,/--dry-run --experimental-auto-create=false/);
  assert.match(yaml,/tests\/bor-chat-private-backup-staging\.test\.js/);
  assert.match(yaml,/tests\/bor-ai-private-backup-r2-audit\.test\.js/);
  assert.match(yaml,/No production Worker deploy, D1 export, R2 write, restore, schema mutation or paid image call/);
});

test('both dedicated secrets are required BEFORE backup Worker deployment, not checked afterward',()=>{
  const audit=yaml.indexOf('- name: Verify existing dedicated R2 backup bucket is private (GET only)');
  const gate=yaml.indexOf('- name: Fail before deploy if either dedicated backup credential is unavailable');
  const deploy=yaml.indexOf('- name: Deploy ONLY the isolated backup Worker and Cloudflare Workflow');
  assert.ok(audit>=0&&gate>audit&&deploy>gate,'strict audit, credential gate, deploy order');
  const step=yaml.slice(gate,deploy);
  assert.ok(step.includes("if: ${{ inputs.phase == 'deploy' || inputs.phase == 'preflight' }}"));
  assert.match(step,/CLOUDFLARE_BACKUP_DEPLOY_TOKEN: \$\{\{ secrets\.CLOUDFLARE_BACKUP_DEPLOY_TOKEN \}\}/);
  assert.match(step,/BOR_PRIVATE_D1_EXPORT_TOKEN: \$\{\{ secrets\.BOR_PRIVATE_D1_EXPORT_TOKEN \}\}/);
  assert.match(step,/Dedicated Worker deploy AND D1 export credentials are required before deploy/);
  assert.match(step,/Cloudflare account ID missing or malformed/);
  assert.doesNotMatch(step,/wrangler@|curl |d1 export|r2 bucket|secret put|echo.*\$\{(?:BOR_PRIVATE_D1_EXPORT_TOKEN|CLOUDFLARE_BACKUP_DEPLOY_TOKEN)/);
});

test('dedicated deployment and D1 export token status + pinned metadata are read-only checked before Worker deploy',()=>{
  const credentialGate=yaml.indexOf('- name: Fail before deploy if either dedicated backup credential is unavailable');
  const readonlyGate=yaml.indexOf('- name: Read-only verify dedicated Cloudflare credentials and exact pinned D1 metadata');
  const deploy=yaml.indexOf('- name: Deploy ONLY the isolated backup Worker and Cloudflare Workflow');
  assert.ok(credentialGate>=0&&readonlyGate>credentialGate&&deploy>readonlyGate);
  const step=yaml.slice(readonlyGate,deploy);
  assert.match(step,/inputs\.phase == 'deploy'/);
  assert.match(step,/method:'GET'/);
  assert.match(step,/redirect:'error'/);
  assert.match(step,/user\/tokens\/verify/);
  assert.match(step,/verified\.status!=='active'/);
  assert.match(step,/PINNED_D1_ID/);
  assert.match(step,/db\.uuid!==PINNED_D1_ID\|\|db\.name!=='bor-ai-chat'/);
  assert.match(step,/workers\/scripts\?per_page=1/);
  assert.match(step,/CLOUDFLARE_BACKUP_DEPLOY_TOKEN/);
  assert.match(step,/BOR_PRIVATE_D1_EXPORT_TOKEN/);
  assert.match(step,/console\.log\('Dedicated Cloudflare tokens are active/);
  assert.doesNotMatch(step,/method:'POST'|wrangler@|d1 execute|d1 export|workflows trigger|\.sql\b|r2 bucket create|secret put|console\.log\(json/);
});

test('manual PREFLIGHT uses scoped read-only API checks without deployment or export',()=>{
  assert.ok(yaml.includes('options: [plan, preflight, deploy, trigger]'));
  assert.ok(yaml.includes('if [[ "$PHASE" == "plan" || "$PHASE" == "preflight" ]]'));
  assert.ok(yaml.includes('PLAN/PREFLIGHT must not receive mutation or export confirmations'));
  const gate=yaml.indexOf('- name: Fail before deploy if either dedicated backup credential is unavailable');
  const readonly=yaml.indexOf('- name: Read-only verify dedicated Cloudflare credentials and exact pinned D1 metadata');
  const deploy=yaml.indexOf('- name: Deploy ONLY the isolated backup Worker and Cloudflare Workflow');
  const trigger=yaml.indexOf('- name: Manually trigger exactly one owner-approved Cloudflare backup instance');
  const report=yaml.indexOf('- name: Report read-only PREFLIGHT only, no exports or releases');
  assert.ok(gate>=0&&readonly>gate&&deploy>readonly&&trigger>deploy&&report>trigger);
  for(const step of [yaml.slice(gate,readonly),yaml.slice(readonly,deploy)])
    assert.ok(step.includes("inputs.phase == 'deploy' || inputs.phase == 'preflight'"));
  const deployStep=yaml.slice(deploy,trigger);
  assert.ok(deployStep.includes("if: ${{ inputs.phase == 'deploy' }}"));
  assert.ok(!deployStep.includes("inputs.phase == 'preflight'"));
  const triggerStep=yaml.slice(trigger,report);
  assert.ok(triggerStep.includes("if: ${{ inputs.phase == 'trigger' }}"));
  assert.ok(!triggerStep.includes("inputs.phase == 'preflight'"));
  assert.ok(yaml.slice(report).includes("if: ${{ inputs.phase == 'preflight' }}"));
  assert.ok(yaml.slice(report).includes('no D1 export, no R2 writes, no restore'));
});

test('manual PLAN and CI compile the same isolated enabled-shaped release candidate with fake-only inputs',()=>{
  const workflow=readFileSync('.github/workflows/bor-ai-preview-build.yml','utf8');
  const script=readFileSync('scripts/verify-private-chat-backup-release-candidate.mjs','utf8');
  const candidate='node scripts/verify-private-chat-backup-release-candidate.mjs';
  const dry='--config wrangler.chat-private-backup.candidate.generated.jsonc';
  assert.match(yaml,/Compile enabled-shaped isolated release candidate using SYNTHETIC inputs only/);
  assert.ok(yaml.includes(candidate));
  assert.ok(yaml.includes(dry));
  assert.ok(workflow.includes(candidate));
  assert.ok(workflow.includes(dry));
  assert.match(yaml,/--dry-run --experimental-auto-create=false/);
  assert.match(workflow,/--dry-run --experimental-auto-create=false/);
  assert.match(script,/SYNTHETIC_ACCOUNT_ID='00000000000000000000000000000000'/);
  assert.match(script,/SYNTHETIC_SIGNED_HOST='candidate-only\.r2\.cloudflarestorage\.com'/);
  assert.doesNotMatch(script,/process\.env|fetch\(|secret put|workflows trigger|d1 export|r2 object put/);
  const dryStep=yaml.slice(
    yaml.indexOf('- name: Compile enabled-shaped isolated release candidate'),
    yaml.indexOf('- name: Confirm reviewed main is not stale')
  );
  assert.doesNotMatch(dryStep,/\$\{\{ secrets\.|workflows trigger|wrangler@4\.165\.0 deploy --config/);
  assert.match(dryStep,/wrangler@4\.165\.0 deploy --dry-run/);
});
