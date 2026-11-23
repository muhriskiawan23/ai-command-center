import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  expectedD1Identities,inspectCloudflareD1Metadata
} from '../scripts/audit-cloudflare-d1-metadata-readonly.mjs';

// All checks in this regression run OFFLINE with fixture identifiers.
// No remote Cloudflare API, D1 SQL or deploy is invoked by this test.
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const production=JSON.parse(read('wrangler.jsonc'));
const proof=JSON.parse(read('wrangler.duitku-sandbox.jsonc'));
const stage='11111111-1111-4111-8111-111111111111';
const shadow='22222222-2222-4222-8222-222222222222';
const accountId='f'.repeat(32);
const token='fake-offline-only-read-scope-token-never-live-000001';
const IDs=()=>expectedD1Identities({production,sandbox:proof,stagingId:stage,shadowId:shadow});

test('production deployment gates remote shadow schema SQL behind four D1 read-only metadata checks',()=>{
  const workflow=read('.github/workflows/bor-ai-deploy.yml');
  const consent=workflow.indexOf('run: node scripts/review-billing-shadow-dispatch.mjs');
  const metadata=workflow.indexOf('run: node scripts/audit-cloudflare-d1-metadata-readonly.mjs');
  const config=workflow.indexOf('run: node scripts/prepare-billing-shadow-config.mjs');
  const schema=workflow.indexOf('--file staging/billing-shadow/0001_readonly_schema.sql');
  assert.ok(consent>0&&metadata>consent&&config>metadata&&schema>config,
    'consent and four-D1 metadata must execute before shadow schema write');
  const step=workflow.slice(workflow.lastIndexOf('      - name:',metadata),metadata);
  assert.match(step,/if: \$\{\{ env\.BOR_BILLING_SHADOW_ENABLED == 'true' \}\}/);
  assert.match(step,/BOR_CLOUDFLARE_D1_READ_TOKEN: \$\{\{ secrets\.BOR_CLOUDFLARE_D1_READ_TOKEN \}\}/);
  assert.match(step,/BOR_BILLING_STAGING_D1_ID: \$\{\{ secrets\.BOR_BILLING_STAGING_D1_ID \}\}/);
  assert.match(step,/CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
  assert.doesNotMatch(step,/CLOUDFLARE_API_TOKEN|CLOUDFLARE_D1_MIGRATION_TOKEN|wrangler d1 execute/);
  assert.match(workflow,/BOR_BILLING_SHADOW_D1_ID: \$\{\{ inputs\.billing_shadow_d1_id \}\}/);
});
test('a shadow ID reused from the real staging D1 is rejected before any GET',()=>{
  assert.throws(()=>expectedD1Identities({
    production,sandbox:proof,stagingId:stage,shadowId:stage
  }),/d1_identifier_reuse_blocked/);
});
test('four-D1 audit never requests rows and requires exact UUID/name metadata',async()=>{
  const ids=IDs(); const queried=[];
  const result=await inspectCloudflareD1Metadata({
    accountId,token,identities:ids,
    fetcher:async(url,request)=>{
      queried.push({url,request});
      assert.equal(request.method,'GET');
      assert.equal(request.redirect,'error');
      assert.equal(request.headers.Authorization,'Bearer '+token);
      const requested=new URL(url);
      assert.equal(requested.origin,'https://api.cloudflare.com');
      assert.equal(requested.searchParams.get('fields'),'uuid,name');
      const expected=ids.find(x=>requested.pathname.endsWith('/'+x.uuid));
      assert.ok(expected);
      return {ok:true,status:200,json:async()=>({
        success:true,result:{name:expected.name,uuid:expected.uuid}
      })};
    }
  });
  assert.equal(queried.length,4);
  assert.deepEqual(result.databaseStatuses.map(x=>x.label),[
    'chat','duitku_proof','billing_staging','billing_shadow'
  ]);
  assert.equal(result.allVerified,true);
  assert.equal(result.schemaAttestationVerified,false);
  assert.equal(result.liveCreditsEnabled,false);
  assert.equal(result.livePaymentsEnabled,false);
});
test('wrong staging name stops the audit and cannot count as shadow approval',async()=>{
  const ids=IDs();let calls=0;
  await assert.rejects(()=>inspectCloudflareD1Metadata({
    accountId,token,identities:ids,
    fetcher:async(url)=>{
      calls++;const expected=ids.find(x=>url.includes(x.uuid));
      return {ok:true,status:200,json:async()=>({
        success:true,result:{uuid:expected.uuid,name:expected.label==='billing_staging'
          ? 'bor-ai-billing-shadow':expected.name}
      })};
    }
  }),/cloudflare_d1_metadata_identity_mismatch/);
  assert.equal(calls,3,'must not proceed to shadow after staging identity mismatch');
});
