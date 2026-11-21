import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {APPROVED_IMAGE_MIGRATIONS,proveIsolatedImageSchema} from '../scripts/image-migration-offline-proof.mjs';

test('image job and conversation history migrations work in-memory without synthetic billing SQL',()=>{
  const proof=proveIsolatedImageSchema();
  assert.equal(proof.offline,true);
  assert.equal(proof.productionChanges,false);
  assert.equal(proof.canApplyToProduction,false);
  assert.equal(proof.imageSchemaValid,true);
  assert.equal(proof.baseMigrationsChecked,11);
  assert.equal(proof.billingMigrationsApplied,0);
  assert.deepEqual(proof.isolatedMigrations,['0012_image_jobs.sql','0016_image_chat_history.sql']);
  assert.equal(proof.d1TimeTravelBookmark,'not_verified');
});
test('only reviewed image migration names appear in allowlist and no billing files are selected',()=>{
  assert.deepEqual([...APPROVED_IMAGE_MIGRATIONS],['0012_image_jobs.sql','0016_image_chat_history.sql']);
  assert.equal(APPROVED_IMAGE_MIGRATIONS.some(x=>/001[345]|billing|sandbox/i.test(x)),false);
});
test('offline proof does not include credential, network, production D1 or deployment operations',()=>{
  const script=readFileSync(new URL('../scripts/image-migration-offline-proof.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(script,/\b(?:fetch\(|wrangler\s+d1\s+migrations\s+apply|wrangler\s+deploy|OPENAI_API_KEY|CLOUDFLARE_API_TOKEN|D1_DATABASE_ID)\b/);
  assert.match(script,/new DatabaseSync\(':memory:'\)/);
});
