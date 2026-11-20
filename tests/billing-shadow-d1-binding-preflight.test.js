import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditBillingShadowBinding} from '../scripts/check-billing-shadow-d1-binding.mjs';

const read=path=>JSON.parse(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
const STAGING='22222222-2222-4222-8222-222222222222';
const SHADOW='33333333-3333-4333-8333-333333333333';
const BASE=()=>{
  const production=read('wrangler.jsonc');
  const stagingTemplate=read('wrangler.billing-staging.jsonc');
  const proof=read('wrangler.duitku-sandbox.jsonc');
  const candidate=structuredClone(production);
  candidate.d1_databases.push({
    binding:'BILLING_SHADOW_DB',
    database_name:'bor-ai-billing-shadow',
    database_id:SHADOW,
    migrations_dir:'staging/billing-shadow'
  });
  candidate.vars.BOR_BILLING_SHADOW_D1_NAME='bor-ai-billing-shadow';
  candidate.vars.BOR_BILLING_SHADOW_ENABLED='false';
  return {production,stagingTemplate,proof,candidate,liveStagingD1Id:STAGING};
};
function rejects(label,change,code){
  test(label,()=>{
    const inputs=BASE();
    change(inputs);
    const report=auditBillingShadowBinding(inputs);
    assert.equal(report.ok,false);
    assert.ok(report.failures.includes(code),JSON.stringify(report.failures));
    assert.doesNotMatch(JSON.stringify(report),/22222222|33333333|d71231a9/i);
  });
}
test('offline preflight permits only a disabled candidate with a unique dedicated shadow D1',()=>{
  const opts=BASE();
  const result=auditBillingShadowBinding(opts);
  assert.deepEqual(result,{ok:true,failures:[]});
  assert.equal(opts.production.d1_databases.length,1);
  assert.equal(opts.production.vars.BOR_BILLING_SHADOW_ENABLED,undefined);
  assert.equal(opts.stagingTemplate.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000000');
});
rejects('cannot pass without actual staging D1 identity',o=>{o.liveStagingD1Id=undefined},'live_staging_d1_id_required_for_comparison');
rejects('reject shadow binding to production chat D1',o=>{o.candidate.d1_databases[1].database_id=o.production.d1_databases[0].database_id},'shadow_database_id_reused');
rejects('reject shadow binding to real staging D1',o=>{o.candidate.d1_databases[1].database_id=STAGING},'shadow_database_id_reused');
rejects('reject shadow binding to fixed Duitku proof D1',o=>{o.candidate.d1_databases[1].database_id=o.proof.d1_databases[0].database_id},'shadow_database_id_reused');
rejects('reject same database assigned to both staging and chat',o=>{o.liveStagingD1Id=o.production.d1_databases[0].database_id},'staging_d1_collides_with_known_binding');
rejects('reject candidate changing original production chat DB ID',o=>{o.candidate.d1_databases[0].database_id=SHADOW},'candidate_chat_binding_changed');
rejects('reject migration path pointing at production chat migrations',o=>{o.candidate.d1_databases[1].migrations_dir='migrations'},'shadow_binding_invalid_or_migration_dir_unsafe');
rejects('reject shadow database name that would bypass expected attestation',o=>{o.candidate.d1_databases[1].database_name='bor-ai-billing-staging'},'shadow_binding_invalid_or_migration_dir_unsafe');
rejects('reject all-zero placeholder for shadow ID',o=>{o.candidate.d1_databases[1].database_id='00000000-0000-0000-0000-000000000000'},'shadow_binding_invalid_or_migration_dir_unsafe');
rejects('reject shadow enabling in candidate',o=>{o.candidate.vars.BOR_BILLING_SHADOW_ENABLED='true'},'shadow_feature_must_remain_off');
rejects('reject including HMAC pepper plaintext in candidate variables',o=>{o.candidate.vars.BOR_BILLING_SHADOW_PEPPER='should-not-be-here'},'secrets_must_not_be_plaintext_vars');
rejects('reject missing expected shadow name variable',o=>{delete o.candidate.vars.BOR_BILLING_SHADOW_D1_NAME},'shadow_db_name_attestation_config_missing');
rejects('reject attaching other binding to production Worker',o=>{o.candidate.d1_databases.push({binding:'BILLING_DB',database_name:'bor-ai-billing-staging',database_id:STAGING})},'candidate_worker_binding_layout_invalid');
rejects('reject production baseline modified to include shadow activation',o=>{o.production.vars.BOR_BILLING_SHADOW_ENABLED='true'},'production_shadow_must_remain_off');
