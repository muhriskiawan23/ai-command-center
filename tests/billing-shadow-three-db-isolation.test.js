import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleBillingShadowAccountRequest,deriveShadowSubject} from '../src/billing-account-shadow.js';

// A persistence-level OFFLINE proof, not a live Cloudflare/Duitku test.
// Three distinct SQLite files model the existing chat D1, staging D1 and
// future isolated shadow D1. No production DB credentials are used.
const PEPPER='offline-only-shadow-integration-secret-00000000000001';
const A='123456789012345678901', B='234567890123456789012';
const ENDPOINT='https://bor-ai.example.test/api/billing/account';
function d1(db){
  return {prepare(sql){
    return {
      first:async()=>db.prepare(sql).get()??null,
      bind(...args){return {first:async()=>db.prepare(sql).get(...args)??null};}
    };
  }};
}
async function call(env, id, headers={}){
  return handleBillingShadowAccountRequest(new Request(ENDPOINT,{headers}),env,{
    // Simulates the server's verified-session return value, NEVER a browser ID.
    getSession:async()=>id?{id}:null
  });
}
function snapshot(db){
  return db.prepare('SELECT name, type, sql FROM sqlite_master WHERE type IN (\'table\',\'index\') ORDER BY name').all();
}
test('three durable databases stay distinct and only shadow status is readable',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'bor-billing-shadow-isolation-'));
  const chat=new DatabaseSync(join(dir,'chat.sqlite'));
  const stage=new DatabaseSync(join(dir,'stage.sqlite'));
  const shadow=new DatabaseSync(join(dir,'shadow.sqlite'));
  try{
    chat.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL); INSERT INTO sessions VALUES ('PRIVATE_SESSION','123456789012345678901');");
    stage.exec("CREATE TABLE stage_wallets (user_id TEXT PRIMARY KEY, test_credits INTEGER NOT NULL); INSERT INTO stage_wallets VALUES ('STAGE-fixture',3000);");
    shadow.exec(readFileSync(new URL('../staging/billing-shadow/0001_readonly_schema.sql',import.meta.url),'utf8'));
    const chatSchema=JSON.stringify(snapshot(chat));
    const stageSchema=JSON.stringify(snapshot(stage));
    const shadowSchema=JSON.stringify(snapshot(shadow));
    const env={
      BOR_BILLING_SHADOW_ENABLED:'true',
      BOR_BILLING_SHADOW_D1_NAME:'bor-ai-billing-shadow',
      BOR_BILLING_SHADOW_PEPPER:PEPPER,
      DB:d1(chat),
      BILLING_SHADOW_DB:d1(shadow)
    };
    const key=await deriveShadowSubject(A,PEPPER);
    shadow.prepare('INSERT INTO billing_shadow_accounts (subject_hash,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?)')
      .run(key,'under_review',1,2);
    let response=await call(env,A);
    assert.equal(response.status,200);
    let body=await response.json();
    assert.equal(body.accountStatus,'under_review');
    assert.equal(body.credits,null);
    assert.equal(body.billingReady,false);
    assert.equal(body.productionCheckoutEnabled,false);
    assert.equal(body.realCreditsGranted,false);
    assert.equal(body.realSubscriptionEnabled,false);
    assert.doesNotMatch(JSON.stringify(body),/PRIVATE_SESSION|STAGE-fixture|123456789012345678901|3000/);

    response=await call(env,B,{'X-User-Id':A,'X-Billing-Account':A});
    assert.equal(response.status,200);
    assert.equal((await response.json()).accountStatus,'not_enrolled');

    // A staging D1 binding cannot pass shadow attestation.
    response=await call({...env,BILLING_SHADOW_DB:d1(stage)},A);
    assert.equal(response.status,503);
    response=await call({...env,BILLING_SHADOW_DB:d1(chat)},A);
    assert.equal(response.status,503);
    response=await call({...env,BILLING_SHADOW_DB:env.DB},A);
    assert.equal(response.status,503);
    response=await call({...env,BOR_BILLING_SHADOW_ENABLED:undefined},A);
    assert.equal(response.status,404);
    response=await call(env,null);
    assert.equal(response.status,401);

    assert.equal(JSON.stringify(snapshot(chat)),chatSchema);
    assert.equal(JSON.stringify(snapshot(stage)),stageSchema);
    assert.equal(JSON.stringify(snapshot(shadow)),shadowSchema);
    assert.equal(chat.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
    assert.equal(stage.prepare('SELECT test_credits FROM stage_wallets').get().test_credits,3000);
    assert.equal(shadow.prepare('SELECT COUNT(*) AS n FROM billing_shadow_accounts').get().n,1);
    assert.equal(shadow.prepare('SELECT status FROM billing_shadow_accounts WHERE subject_hash=?').get(key).status,'under_review');
    assert.equal(chat.prepare('PRAGMA database_list').all().length,1);
    assert.equal(stage.prepare('PRAGMA database_list').all().length,1);
    assert.equal(shadow.prepare('PRAGMA database_list').all().length,1);
  }finally{
    chat.close();stage.close();shadow.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
