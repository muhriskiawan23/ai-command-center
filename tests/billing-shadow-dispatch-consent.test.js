import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  SHADOW_CONFIRMATION,reviewBillingShadowDispatch
} from '../scripts/review-billing-shadow-dispatch.mjs';

const production=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const sandbox=JSON.parse(readFileSync(new URL('../wrangler.duitku-sandbox.jsonc',import.meta.url),'utf8'));
const ID='99999999-9999-4999-8999-999999999999';
function inputs(extra={}){
  return {
    production,sandbox,enabled:'true',
    confirmation:SHADOW_CONFIRMATION,
    shadowD1Id:ID,
    ...extra
  };
}
test('normal production dispatch keeps billing off and requires no new approval',()=>{
  assert.deepEqual(reviewBillingShadowDispatch({enabled:'false'}),{
    billingShadowAuthorized:false
  });
});
test('shadow release cannot happen with absent or incorrect typed approval',()=>{
  for(const confirmation of ['',undefined,'true','yes','CONFIRM_BOR_AI_IMAGE_PILOT_RELEASE',
    SHADOW_CONFIRMATION.toLowerCase()]){
    assert.throws(()=>reviewBillingShadowDispatch(inputs({confirmation})),
      /billing_shadow_explicit_confirmation_required/);
  }
  assert.equal(reviewBillingShadowDispatch(inputs()).billingShadowAuthorized,true);
});
test('shadow D1 must not reuse production chat, sandbox, null or malformed UUID',()=>{
  for(const shadowD1Id of [
    '',undefined,'00000000-0000-0000-0000-000000000000',
    production.d1_databases[0].database_id,
    production.d1_databases[0].database_id.toUpperCase(),
    sandbox.d1_databases[0].database_id,'not-an-id'
  ])assert.throws(()=>reviewBillingShadowDispatch(inputs({shadowD1Id})),
    /billing_shadow_distinct_d1_id_required/);
});
test('shadow activation refuses other release changes even with valid approval',()=>{
  for(const flag of [
    'applyMigrations','runTavilySmoke','preserveReader','allowReaderShutdown',
    'enableImagePilot','imagesEnabled','lunaPrimary'
  ])assert.throws(
    ()=>reviewBillingShadowDispatch(inputs({[flag]:'true'})),
    /billing_shadow_must_be_released_alone/,flag
  );
});
test('shadow release fails closed when reviewed manifests are altered',()=>{
  assert.throws(()=>reviewBillingShadowDispatch(inputs({
    production:{...production,name:'some-other-worker'}
  })),/billing_shadow_checked_in_identity_mismatch/);
  assert.throws(()=>reviewBillingShadowDispatch(inputs({
    production:{...production,vars:{...production.vars,BOR_BILLING_SHADOW_ENABLED:'true'}}
  })),/billing_shadow_must_remain_off_in_checked_in_config/);
  assert.throws(()=>reviewBillingShadowDispatch(inputs({
    production:{...production,d1_databases:[...production.d1_databases,{
      binding:'BILLING_SHADOW_DB',database_name:'bor-ai-billing-shadow',database_id:ID
    }]}
  })),/billing_shadow_checked_in_identity_mismatch|billing_shadow_must_remain_off_in_checked_in_config/);
  assert.throws(()=>reviewBillingShadowDispatch(inputs({enabled:'maybe'})),
    /billing_shadow_invalid_dispatch_boolean_enabled/);
});
test('production workflow runs consent gate before any D1 write or deployment',()=>{
  const workflow=readFileSync(new URL('../.github/workflows/bor-ai-deploy.yml',import.meta.url),'utf8');
  const input=workflow.indexOf('      billing_shadow_confirmation:');
  const gate=workflow.indexOf('run: node scripts/review-billing-shadow-dispatch.mjs');
  const credentials=workflow.indexOf('      - name: Validate required credentials');
  const mutation=workflow.indexOf('d1 execute bor-ai-billing-shadow --remote');
  assert.ok(input>0&&gate>input&&credentials>gate&&mutation>credentials);
  assert.match(workflow,/BOR_BILLING_SHADOW_CONFIRMATION: \$\{\{ inputs\.billing_shadow_confirmation \}\}/);
  assert.match(workflow,/BOR_APPLY_DB_MIGRATIONS: \$\{\{ inputs\.apply_db_migrations/);
});
