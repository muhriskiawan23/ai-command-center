import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 ACCOUNT_PIN,PROD_D1_PIN,REVIEWED_PR_SHA,OWNER_APPROVAL,COST_APPROVAL,
 identity,safePreflight,validateCreatedD1
} from '../scripts/run-one-shot-chat-journal-d1-staging.mjs';

const runId='45129874592',uuid='8c5f0ad6-b892-48c7-b4c3-5c6e2a890ef0';
const vars={
  GITHUB_RUN_ID:runId,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'push',
  GITHUB_RUN_ATTEMPT:'1',BOR_OWNER_APPROVAL:OWNER_APPROVAL,BOR_COST_APPROVAL:COST_APPROVAL,
  BOR_REVIEWED_PR_SHA:REVIEWED_PR_SHA,CLOUDFLARE_ACCOUNT_ID:ACCOUNT_PIN,
  CLOUDFLARE_API_TOKEN:'REDACTED_TEST_TOKEN_OF_EXPECTED_LENGTH',
  BOR_PRIVATE_D1_EXPORT_TOKEN:'REDACTED_TEST_D1_TOKEN_OF_EXPECTED_LENGTH',
  BOR_PR_DIR:'/runner/reviewed-recovery-pr',
  BOR_WRANGLER_BIN:'/runner/tools/wrangler'
};
test('one exact run ID scopes the DB, Worker, Workflow and instance',()=>{
  assert.deepEqual(identity(runId),{
    db:'bor-ai-journal-recovery-'+runId,worker:'bor-ai-chat-recovery-d1-'+runId,
    workflow:'bor-ai-chat-recovery-d1-drill-'+runId,instance:'bor-recovery-'+runId
  });
  for(const x of ['../../prod','', '1', '999999999999999999999'])
    assert.throws(()=>identity(x),/invalid_run_id/);
});
test('hard-stop for unapproved, cost-unapproved, wrong account, wrong SHA, wrong branch or attempt',()=>{
  assert.deepEqual(safePreflight(vars),identity(runId));
  for(const patch of [
    {BOR_COST_APPROVAL:''},{BOR_OWNER_APPROVAL:'yes'},
    {BOR_REVIEWED_PR_SHA:PROD_D1_PIN},{GITHUB_REF:'refs/heads/test'},
    {GITHUB_EVENT_NAME:'workflow_dispatch'},{GITHUB_RUN_ATTEMPT:'2'},
    {CLOUDFLARE_ACCOUNT_ID:'00000000000000000000000000000000'},
    {BOR_PR_DIR:'/tmp/other'},{BOR_WRANGLER_BIN:'/tmp/secret'}
  ])assert.throws(()=>safePreflight({...vars,...patch}),/staging_runner_preflight_denied/);
});
test('no production D1 or provider-created name mismatch is accepted',()=>{
  assert.equal(validateCreatedD1({name:identity(runId).db,uuid},identity(runId).db),uuid);
  for(const x of [{name:'bor-ai-chat',uuid},{name:identity(runId).db,uuid:PROD_D1_PIN},
    {name:identity(runId).db,uuid:'bad'}])
    assert.throws(()=>validateCreatedD1(x,identity(runId).db),/unexpected_disposable_d1_identity/);
});

test('only exact main push carrying the one-shot workflow can cause live mutation',()=>{
  const wf=readFileSync('.github/workflows/bor-ai-closed-do-d1-staging-one-shot.yml','utf8');
  assert.match(wf,/branches: \[main\]/);
  assert.match(wf,/paths:/);
  assert.match(wf,/startsWith\(github\.event\.head_commit\.message/);
  assert.match(wf,/github\.run_attempt == 1/);
  assert.match(wf,/ref: b7e8b97f8fd68c4cf0e3aa8b84e2ff988146e657/);
  assert.match(wf,/environment: production/);
  assert.doesNotMatch(wf,/^  pull_request:|^  schedule:|^  workflow_run:/m);
  assert.doesNotMatch(wf,/npx.+wrangler.+deploy.+--config wrangler\.jsonc/);
});
