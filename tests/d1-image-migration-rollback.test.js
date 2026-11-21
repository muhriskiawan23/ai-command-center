import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkD1RollbackReadiness } from '../scripts/verify-d1-image-migration-rollback.mjs';

const uuid='d71231a9-9a04-471c-b904-d1bc843940aa';
const sampleBookmark='00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683';
const config={d1_databases:[{binding:'DB',database_name:'bor-ai-chat',database_id:uuid}]};
const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'test-token-do-not-print'};
const okay=result=>Response.json({success:true,result});
const getFetcher=(calls=[])=>async(url,options)=>{
  calls.push({url,method:options.method});
  assert.equal(options.method,'GET');
  assert.equal(options.redirect,'error');
  if(url.endsWith('/time_travel/bookmark'))return okay({bookmark:sampleBookmark});
  if(url.endsWith('/d1/database/'+uuid))return okay({uuid,name:'bor-ai-chat'});
  throw Error('Unexpected URL in read-only migration preflight');
};
test('rollback preflight checks pinned D1 and current bookmark by GET only',async()=>{
  const calls=[];
  const result=await checkD1RollbackReadiness({
    env,config,fetcher:getFetcher(calls),now:()=>Date.parse('2026-11-21T14:01:02.000Z')
  });
  assert.equal(result.database,'bor-ai-chat');
  assert.equal(result.rollbackAvailable,true);
  assert.equal(result.beforeMigrationUTC,'2026-11-21T14:01:02.000Z');
  assert.match(result.bookmarkFingerprint,/^[0-9a-f]{16}$/);
  assert.equal(calls.length,2);
  assert.ok(calls.every(x=>x.method==='GET'&&x.url.startsWith('https://api.cloudflare.com/client/v4/accounts/')));
  assert.doesNotMatch(JSON.stringify(result),/test-token-do-not-print|00000085/);
});
test('missing credentials, unrelated D1 identity or wrong binding rejects all migration attempts',async()=>{
  await assert.rejects(checkD1RollbackReadiness({env:{},config,fetcher:getFetcher()}),/credentials unavailable/);
  await assert.rejects(checkD1RollbackReadiness({env,config:{d1_databases:[{binding:'DB',database_name:'other',database_id:uuid}]},fetcher:getFetcher()}),/identity is ambiguous/);
  await assert.rejects(checkD1RollbackReadiness({env,config:{d1_databases:[config.d1_databases[0],config.d1_databases[0]]},fetcher:getFetcher()}),/identity is ambiguous/);
  await assert.rejects(checkD1RollbackReadiness({env,config,fetcher:async(url)=>{
    if(url.endsWith('/time_travel/bookmark'))return okay({bookmark:sampleBookmark});
    return okay({uuid:uuid.replace('d','e'),name:'bor-ai-chat'});
  }}),/does not match/);
});
test('Time Travel API denial or missing bookmark blocks production migration',async()=>{
  await assert.rejects(checkD1RollbackReadiness({env,config,fetcher:async(url)=>{
    if(url.endsWith('/time_travel/bookmark'))return new Response('',{status:403});
    return okay({uuid,name:'bor-ai-chat'});
  }}),/Cannot prove production D1 rollback readiness/);
  await assert.rejects(checkD1RollbackReadiness({env,config,fetcher:async(url)=>{
    if(url.endsWith('/time_travel/bookmark'))return okay({});
    return okay({uuid,name:'bor-ai-chat'});
  }}),/bookmark cannot be verified/);
  await assert.rejects(checkD1RollbackReadiness({env,config,fetcher:async(url)=>{
    if(url.endsWith('/time_travel/bookmark'))return okay({bookmark:'invalid'});
    return okay({uuid,name:'bor-ai-chat'});
  }}),/bookmark cannot be verified/);
});
test('D1 deployment must run the restore-point guard after migration scan but before APPLY',()=>{
 const wf=readFileSync(new URL('../.github/workflows/bor-ai-deploy.yml',import.meta.url),'utf8');
 const scan=wf.indexOf('node scripts/check-production-migration-isolation.mjs migrations');
 const rollback=wf.indexOf('node scripts/verify-d1-image-migration-rollback.mjs');
 const apply=wf.indexOf('d1 migrations apply bor-ai-chat --remote');
 assert.ok(scan>=0&&rollback>scan&&apply>rollback,'migration must be gated by isolation and restore point');
 assert.match(wf,/name: Require production D1 rollback bookmark before migration\n\s+if: \$\{\{ inputs\.apply_db_migrations \}\}/);
});
