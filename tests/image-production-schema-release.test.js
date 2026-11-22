import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifyImageProductionSchema,IMAGE_REQUIRED_OBJECTS} from '../scripts/verify-image-production-schema.mjs';

const validObjects=()=>Object.entries(IMAGE_REQUIRED_OBJECTS).map(([name,type])=>({name,type}));
const validColumns=()=>['id','user_id','request_id','status','source_key','output_key','credits','tariff_version','conversation_id'].map(name=>({name}));
test('image schema inspection requires complete typed objects and chat association',()=>{
  assert.deepEqual(verifyImageProductionSchema(validObjects(),validColumns()),{
    verified:true,objectsChecked:11,chatAssociationVerified:true,readOnly:true
  });
  for(const name of Object.keys(IMAGE_REQUIRED_OBJECTS)){
    assert.throws(()=>verifyImageProductionSchema(validObjects().filter(row=>row.name!==name),validColumns()),
      /image_schema_object_missing_or_wrong_type/);
  }
  assert.throws(()=>verifyImageProductionSchema([...validObjects(),validObjects()[0]],validColumns()),/image_schema_metadata_invalid/);
  assert.throws(()=>verifyImageProductionSchema(validObjects(),validColumns().filter(row=>row.name!=='conversation_id')),
    /image_job_column_missing/);
  assert.throws(()=>verifyImageProductionSchema('bogus',validColumns()),/image_schema_metadata_unverifiable/);
});
test('legacy image-schema workflow is strict read-only inventory; cannot bypass stronger production gate',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/bor-ai-image-schema-release.yml',import.meta.url),'utf8');
  assert.match(yaml,/workflow_dispatch:/);
  assert.match(yaml,/apply_image_schema:/);
  assert.match(yaml,/READ-ONLY inventory/);
  assert.match(yaml,/APPLY_IMAGE_SCHEMA/);
  assert.match(yaml,/if \[\[ "\$APPLY_IMAGE_SCHEMA" != "false" \|\| -n "\$OWNER_CONFIRMATION" \]\]/);
  assert.match(yaml,/--expect-pair/);
  assert.match(yaml,/concurrency:[\s\S]*?group: bor-ai-production-deploy/);
  assert.match(yaml,/environment: production/);
  assert.match(yaml,/bor-ai-image-d1-release\.yml/);
  assert.doesNotMatch(yaml,/d1 migrations apply bor-ai-chat|d1 execute bor-ai-chat|d1 time-travel restore/);
  assert.doesNotMatch(yaml,/wrangler(?:@\S+)?\s+deploy\b|OPENAI_API_KEY|TAVILY_API_KEY/);
});
test('strict image D1 release requires SHA-bound owner approval and independent private recovery proof',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/bor-ai-image-d1-release.yml',import.meta.url),'utf8');
  assert.match(yaml,/CONFIRM_IMAGE_SCHEMA_0012_0016_BOR_AI_CHAT/);
  assert.match(yaml,/REVIEWED_PLAN_SHA.*\$\{\{ inputs\.reviewed_plan_sha \}\}/);
  assert.match(yaml,/PRIVATE_D1_RECOVERY_EVIDENCE_REVIEWED/);
  assert.match(yaml,/\"\$REVIEWED_PLAN_SHA\" != \"\$GITHUB_SHA\"/);
  assert.match(yaml,/git ls-remote origin refs\/heads\/main/);
  assert.match(yaml,/d1 migrations apply bor-ai-chat --remote/);
  assert.match(yaml,/id: approved_image_sql_apply/);
  assert.match(yaml,/continue-on-error: true/);
  assert.match(yaml,/steps\.approved_image_sql_apply\.outcome == 'failure'/);
  assert.match(yaml,/image-d1-after-failed-apply\.txt/);
  assert.match(yaml,/--expect-pair/);
  assert.match(yaml,/Fail a refused migration even if postfailure inventory is unchanged/);
  assert.match(yaml,/steps\.approved_image_sql_apply\.outcome == 'success'/);
  assert.match(yaml,/--expect-none/);
  assert.doesNotMatch(yaml,/d1 time-travel restore|d1 backup restore|wrangler(?:@\S+)?\s+deploy\b/);
});
