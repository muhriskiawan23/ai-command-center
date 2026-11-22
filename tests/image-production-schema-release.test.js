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
test('image-only production migration workflow is manual and cannot deploy or restore Worker/chat',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/bor-ai-image-schema-release.yml',import.meta.url),'utf8');
  assert.match(yaml,/workflow_dispatch:/);
  assert.match(yaml,/apply_image_schema:/);
  assert.match(yaml,/APPLY_IMAGE_SCHEMA_BOR_AI/);
  assert.match(yaml,/concurrency:[\s\S]*?group: bor-ai-production-deploy/);
  assert.match(yaml,/environment: production/);
  assert.match(yaml,/if: \$\{\{ inputs\.apply_image_schema \}\}/);
  assert.match(yaml,/--expect-pair/);
  assert.match(yaml,/--expect-none/);
  assert.match(yaml,/d1 migrations apply bor-ai-chat --remote/);
  assert.match(yaml,/wrangler\.image-only-migrations\.generated\.jsonc/);
  assert.doesNotMatch(yaml,/wrangler(?:@\S+)?\s+deploy\b/);
  assert.doesNotMatch(yaml,/d1 time-travel restore|d1 backup restore|d1 export\b/);
  assert.doesNotMatch(yaml,/OPENAI_API_KEY|TAVILY_API_KEY|billing_shadow/);
});
