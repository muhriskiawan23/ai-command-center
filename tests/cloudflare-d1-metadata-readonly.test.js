import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expectedD1Identities,inspectCloudflareD1Metadata} from '../scripts/audit-cloudflare-d1-metadata-readonly.mjs';
const read=p=>JSON.parse(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const accountId='0'.repeat(32);
const token='offline-mock-d1-read-token-not-real-00000000000';
const stage='11111111-1111-4111-8111-111111111111';
const shadow='22222222-2222-4222-8222-222222222222';
const base=()=>expectedD1Identities({
  production:read('wrangler.jsonc'),
  sandbox:read('wrangler.duitku-sandbox.jsonc'),
  stagingId:stage,shadowId:shadow
});
test('four named DBs require unique IDs and shadow remains disabled',()=>{
  const ids=base();
  assert.equal(ids.length,4);
  assert.equal(new Set(ids.map(x=>x.uuid)).size,4);
  assert.equal(ids[3].name,'bor-ai-billing-shadow');
  assert.throws(()=>expectedD1Identities({
    production:read('wrangler.jsonc'),sandbox:read('wrangler.duitku-sandbox.jsonc'),
    stagingId:stage,shadowId:stage
  }),/d1_identifier_reuse_blocked/);
  assert.throws(()=>expectedD1Identities({
    production:read('wrangler.jsonc'),sandbox:read('wrangler.duitku-sandbox.jsonc'),
    stagingId:stage
  }),/dedicated_d1_identifiers_required/);
});
test('the audit performs exactly four HTTPS GET metadata calls; never SQL, writes, or output of IDs',async()=>{
  const ids=base();
  const seen=[];
  const result=await inspectCloudflareD1Metadata({
    accountId,token,identities:ids,
    fetcher:async(url,options)=>{
      seen.push({url,options});
      assert.equal(options.method,'GET');
      assert.equal(options.headers.Authorization,'Bearer '+token);
      assert.equal(options.redirect,'error');
      const path=new URL(url);
      assert.equal(path.origin,'https://api.cloudflare.com');
      assert.equal(path.searchParams.get('fields'),'uuid,name');
      const entry=ids.find(x=>path.pathname.endsWith('/'+x.uuid));
      assert.ok(entry);
      return {ok:true,status:200,json:async()=>({
        success:true,result:{uuid:entry.uuid,name:entry.name}
      })};
    }
  });
  assert.equal(seen.length,4);
  assert.equal(result.allVerified,true);
  assert.equal(result.schemaAttestationVerified,false);
  assert.equal(result.liveCreditsEnabled,false);
  assert.equal(result.livePaymentsEnabled,false);
  assert.ok(seen.every(x=>x.url.startsWith('https://api.cloudflare.com/client/v4/accounts/')));
  assert.doesNotMatch(JSON.stringify(result),/11111111|22222222|d71231a9|0744f4c0|offline-mock-d1-read-token/);
});
test('absence of dedicated credentials rejects before any network call',async()=>{
  let called=0;const fetcher=async()=>{called++;throw Error('should never call')};
  await assert.rejects(()=>inspectCloudflareD1Metadata({
    accountId,identities:base(),fetcher
  }),/read_only_d1_probe_inputs_missing/);
  assert.equal(called,0);
});
test('bad metadata, denied access and remote failures do not log secret or upstream data',async()=>{
  const ids=base();
  const variants=[
    {ok:true,status:200,json:async()=>({success:true,result:{name:'bor-ai-chat',uuid:ids[1].uuid}})},
    {ok:true,status:200,json:async()=>({success:false,result:{uuid:ids[0].uuid,name:ids[0].name}})},
    {ok:false,status:403,json:async()=>({token:'secret_payload'})},
    null
  ];
  for(const response of variants){
    const fetcher=async()=>{if(response===null)throw Error('upstream_token=PRIVATE');return response};
    await assert.rejects(
      ()=>inspectCloudflareD1Metadata({accountId,token,identities:ids,fetcher}),
      error=>{
        assert.match(error.message,/cloudflare_d1_metadata_(read_failed|identity_mismatch)/);
        assert.doesNotMatch(error.message,/upstream|secret_payload|PRIVATE|offline-mock/);
        return true;
      });
  }
});
