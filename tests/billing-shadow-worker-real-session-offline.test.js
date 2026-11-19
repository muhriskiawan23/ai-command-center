import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import worker from '../src/index.js';
import {deriveShadowSubject} from '../src/billing-account-shadow.js';

// Exercises the *actual* Worker route -> getSession -> D1 JOIN -> HMAC
// -> independently attested shadow D1. No Google provider call or live D1.
const A='123456789012345678901', B='234567890123456789012';
const TOKEN_A='local-only-opaque-google-session-A-not-a-live-cookie';
const TOKEN_B='local-only-opaque-google-session-B-not-a-live-cookie';
const TOKEN_EXPIRED='local-only-expired-google-session-never-valid';
const PEPPER='offline-worker-e2e-shadow-pepper-not-a-real-secret-00001';
const ORIGIN='https://bor-ai.example.test';
const now=()=>Math.floor(Date.now()/1000);
const tokenHash=token=>createHash('sha256').update(token).digest('hex');

function localD1(sqlite, sqlLog){
  return {
    prepare(sql){
      sqlLog.push(sql);
      const get=(params=[])=>sqlite.prepare(sql).get(...params)??null;
      return {
        first:async()=>get(),
        bind(...params){
          return {first:async()=>get(params)};
        }
      };
    }
  };
}
function fetchAccount(env,token,{headers={},path='/api/billing/account'}={}){
  return worker.fetch(new Request(ORIGIN+path,{
    method:'GET',
    headers:{...(token?{Cookie:'__Host-borai_session='+token}:{}),...headers}
  }),env);
}
test('actual Worker session JOIN isolates billing shadow users and rejects expired/forged requests',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'bor-worker-shadow-real-session-'));
  const chat=new DatabaseSync(join(dir,'chat.sqlite'));
  const stage=new DatabaseSync(join(dir,'stage.sqlite'));
  const shadow=new DatabaseSync(join(dir,'shadow.sqlite'));
  const chatQueries=[],shadowQueries=[];
  try{
    chat.exec('PRAGMA foreign_keys = ON');
    chat.exec(readFileSync(new URL('../migrations/0001_auth_and_chat.sql',import.meta.url),'utf8'));
    stage.exec("CREATE TABLE synthetic_wallet (user_id TEXT PRIMARY KEY, credits INTEGER NOT NULL); INSERT INTO synthetic_wallet VALUES ('STAGE-only',5000);");
    shadow.exec(readFileSync(new URL('../staging/billing-shadow/0001_readonly_schema.sql',import.meta.url),'utf8'));

    const clock=now();
    for(const id of [A,B]){
      chat.prepare('INSERT INTO users(id,email,name,picture,created_at,updated_at) VALUES(?,?,?,?,?,?)')
        .run(id,id+'@fixture.invalid','Fixture','',clock,clock);
    }
    for(const [token,id,expiry] of [
      [TOKEN_A,A,clock+3600],[TOKEN_B,B,clock+3600],[TOKEN_EXPIRED,A,clock-10]
    ]){
      chat.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
        .run(tokenHash(token),id,expiry,clock-3600);
    }
    const aHash=await deriveShadowSubject(A,PEPPER);
    shadow.prepare('INSERT INTO billing_shadow_accounts(subject_hash,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?)')
      .run(aHash,'under_review',1,1);
    const env={
      DB:localD1(chat,chatQueries),
      BILLING_SHADOW_DB:localD1(shadow,shadowQueries),
      BOR_BILLING_SHADOW_ENABLED:'true',
      BOR_BILLING_SHADOW_D1_NAME:'bor-ai-billing-shadow',
      BOR_BILLING_SHADOW_PEPPER:PEPPER
    };

    const a=await fetchAccount(env,TOKEN_A);
    assert.equal(a.status,200);
    assert.match(a.headers.get('Cache-Control'),/no-store/);
    const aBody=await a.json();
    assert.equal(aBody.accountStatus,'under_review');
    assert.equal(aBody.credits,null);
    assert.equal(aBody.billingReady,false);
    assert.equal(aBody.realCreditsGranted,false);
    assert.equal(aBody.productionCheckoutEnabled,false);
    assert.doesNotMatch(JSON.stringify(aBody),/fixture.invalid|STAGE-only|5000|123456789012345678901|opaque-google-session/);

    // Browser-supplied selectors do not override the real validated cookie.
    const b=await fetchAccount(env,TOKEN_B,{headers:{
      'X-User-Id':A,'X-Billing-Account':A,'X-Forwarded-User':A
    }});
    assert.equal(b.status,200);
    assert.equal((await b.json()).accountStatus,'not_enrolled');

    for(const token of [TOKEN_EXPIRED,'invalid-cookie-no-session',null]){
      const res=await fetchAccount(env,token);
      assert.equal(res.status,401);
      assert.equal((await res.json()).realCreditsGranted,false);
    }
    assert.equal((await fetchAccount(env,TOKEN_A,{headers:{Origin:'https://attacker.example.test'}})).status,403);
    assert.equal((await fetchAccount(env,TOKEN_A,{path:'/api/billing/account?userId='+B})).status,403);
    assert.equal((await fetchAccount({...env,BOR_BILLING_SHADOW_ENABLED:undefined},TOKEN_A)).status,404);
    assert.equal((await fetchAccount({...env,BILLING_SHADOW_DB:env.DB},TOKEN_A)).status,503);

    assert.ok(chatQueries.some(sql=>sql.includes('FROM sessions JOIN users')));
    assert.ok(chatQueries.every(sql=>/^SELECT\s/i.test(sql)), 'auth DB must only be read');
    assert.ok(shadowQueries.length>0);
    assert.ok(shadowQueries.every(sql=>/^SELECT\s/i.test(sql)), 'shadow DB must only be read');
    assert.equal(stage.prepare('SELECT credits FROM synthetic_wallet').get().credits,5000);
    assert.equal(chat.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,3);
    assert.equal(shadow.prepare('SELECT COUNT(*) AS n FROM billing_shadow_accounts').get().n,1);
    for(const db of [chat,stage,shadow])assert.equal(db.prepare('PRAGMA database_list').all().length,1);
  }finally{
    chat.close();stage.close();shadow.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
