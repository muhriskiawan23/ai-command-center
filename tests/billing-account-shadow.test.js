import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {
  deriveShadowSubject,handleBillingShadowAccountRequest
} from '../src/billing-account-shadow.js';

const ENDPOINT='https://bor-ai.example.test/api/billing/account';
const USER_A='123456789012345678901';
const USER_B='234567890123456789012';
const PEPPER='offline-shadow-only-fixture-pepper-not-a-real-secret-00000001';
const OTHER_PEPPER='offline-shadow-other-fixture-pepper-not-a-real-secret-00002';
function dbHarness(){
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../staging/billing-shadow/0001_readonly_schema.sql',import.meta.url),'utf8'));
  const wrapper={
    prepare(sql){
      return {
        first:async()=>db.prepare(sql).get()??null,
        bind(...args){
          return {first:async()=>db.prepare(sql).get(...args)??null};
        }
      };
    }
  };
  return {db,wrapper,close:()=>db.close()};
}
function config(shadow,overrides={}){
  return {
    BOR_BILLING_SHADOW_ENABLED:'true',
    BOR_BILLING_SHADOW_D1_NAME:'bor-ai-billing-shadow',
    BOR_BILLING_SHADOW_PEPPER:PEPPER,
    CHAT_LIMITER:{async limit(){return {success:true}}},
    DB:{prepare(){throw Error('Production chat DB must NEVER be accessed by shadow lookup')}},
    BILLING_SHADOW_DB:shadow,
    ...overrides
  };
}
const handler=async(env,options={})=>{
  const {user={id:USER_A,email:'private@example.invalid'},method='GET',
    url=ENDPOINT,headers={},getSession,...ignored}=options;
  return handleBillingShadowAccountRequest(
    new Request(url,{method,headers}),
    env,{getSession:getSession??(async()=>user)}
  );
};
const body=async(r)=>r.json();

test('billing shadow feature is off by default and never reads authentication or D1',async()=>{
  let called=0;
  const result=await handler({},{
    getSession:async()=>{called++;throw Error('should not execute')}
  });
  assert.equal(result.status,404);
  assert.equal((await body(result)).productionCheckoutEnabled,false);
  assert.equal(called,0);
  assert.match(result.headers.get('cache-control'),/no-store/);
});

test('only GET without query and without cross-site credentials is accepted',async()=>{
  const h=dbHarness();try{
    const env=config(h.wrapper);
    for(const options of [
      {method:'POST'},
      {method:'PUT'}
    ])assert.equal((await handler(env,options)).status,405);
    for(const options of [
      {url:ENDPOINT+'?userId='+USER_B},
      {url:ENDPOINT+'?credits=999999'},
      {headers:{'Sec-Fetch-Site':'cross-site'}},
      {headers:{'Sec-Fetch-Site':'same-site'}},
      {headers:{Origin:'https://attacker.example.test'}},
      {headers:{Origin:'null'}}
    ])assert.equal((await handler(env,options)).status,403);
    assert.equal((await handler(env)).status,200);
    assert.equal((await handler(env,{headers:{Origin:'https://bor-ai.example.test','Sec-Fetch-Site':'same-origin'}})).status,200);
  }finally{h.close()}
});

test('a missing, expired or malformed Google session cannot select another user wallet',async()=>{
  const h=dbHarness();try{
    const env=config(h.wrapper);
    assert.equal((await handler(env,{user:null})).status,401);
    assert.equal((await handler(env,{
      getSession:async()=>{throw Error('raw cookie, SQL error and secret') }
    })).status,503);
    for(const id of ['STAGE-synthetic-id','',null,'bob@example.test','000',USER_A+'a']){
      const r=await handler(env,{user:{id}});
      assert.equal(r.status,503);
      assert.doesNotMatch(JSON.stringify(await body(r)),/STAGE-|bob@|raw cookie/);
    }
  }finally{h.close()}
});

test('separate dedicated binding and secret are mandatory, never silently reuse production or Sandbox',async()=>{
  const h=dbHarness();try{
    const e=config(h.wrapper);
    for(const diff of [
      {BILLING_SHADOW_DB:undefined},
      {BILLING_SHADOW_DB:e.DB},
      {BOR_BILLING_SHADOW_D1_NAME:'bor-ai-chat'},
      {BOR_BILLING_SHADOW_D1_NAME:'bor-ai-billing-staging'},
      {BOR_BILLING_SHADOW_PEPPER:'short'},
      {BOR_BILLING_SHADOW_PEPPER:undefined},
      {BOR_BILLING_SHADOW_ENABLED:'false'}
    ]){
      const res=await handler({...e,...diff});
      assert.notEqual(res.status,200);
    }
    const wrong={
      prepare(sql){
        if(sql.includes('billing_shadow_attestation'))
          return {first:async()=>({service:'bor-billing-shadow-readonly',database_name:'bor-ai-chat',schema_version:1})};
        return h.wrapper.prepare(sql);
      }
    };
    assert.equal((await handler(config(wrong))).status,503);
  }finally{h.close()}
});

test('shadow requires per-account pseudonymous rate limit and never queries D1 when denied',async()=>{
  const h=dbHarness();try{
    const keys=[];
    const env=config(h.wrapper,{CHAT_LIMITER:{
      async limit({key}){keys.push(key);return {success:true}}
    }});
    const a=await handler(env,{user:{id:USER_A}});
    const b=await handler(env,{user:{id:USER_B}});
    assert.equal(a.status,200);
    assert.equal(b.status,200);
    assert.equal(keys.length,2);
    assert.equal(keys[0],'billing-shadow:'+await deriveShadowSubject(USER_A,PEPPER));
    assert.equal(keys[1],'billing-shadow:'+await deriveShadowSubject(USER_B,PEPPER));
    assert.notEqual(keys[0],keys[1]);
    assert.doesNotMatch(keys.join(','),/123456789012345678901|234567890123456789012|@/);
    let calls=0;
    const noRead={
      prepare(){calls++;throw Error('shadow D1 must not be queried when rate limited')}
    };
    for(const [limiter,status] of [
      [undefined,503],
      [{async limit(){throw Error('sensitive quota error')}},503],
      [{async limit(){return null}},503],
      [{async limit(){return {success:false}}},429]
    ]){
      const res=await handler(config(noRead,{CHAT_LIMITER:limiter}));
      assert.equal(res.status,status);
      assert.equal(res.headers.get('Cache-Control').includes('no-store'),true);
      assert.equal((await res.json()).realCreditsGranted,false);
      if(status===429)assert.equal(res.headers.get('Retry-After'),'60');
      assert.equal(calls,0);
    }
  }finally{h.close()}
});

test('HMAC subject is deterministic but separate across users and secret rotations; no raw Google ID/email',async()=>{
  const aa=await deriveShadowSubject(USER_A,PEPPER);
  assert.match(aa,/^[0-9a-f]{64}$/);
  assert.equal(aa,await deriveShadowSubject(USER_A,PEPPER));
  assert.notEqual(aa,await deriveShadowSubject(USER_B,PEPPER));
  assert.notEqual(aa,await deriveShadowSubject(USER_A,OTHER_PEPPER));
  assert.equal(aa.includes(USER_A),false);
  for(const [id,pepper] of [
    ['STAGE-1234567',PEPPER],[USER_A,'short'],[USER_A,null],
    ['bob@example.test',PEPPER]
  ])await assert.rejects(()=>deriveShadowSubject(id,pepper));
});

test('read-only per-user account status never returns paid plan, credits, identity or commercial entitlements',async()=>{
  const h=dbHarness();try{
    const env=config(h.wrapper);
    const first=await handler(env,{user:{id:USER_A,email:'a@secret.invalid'}});
    assert.equal(first.status,200);
    assert.deepEqual(await body(first),{
      accountStatus:'not_enrolled',source:'read_only_isolated_shadow',
      billingReady:false,commercialEntitlement:false,credits:null,
      productionCheckoutEnabled:false,realCreditsGranted:false,
      realSubscriptionEnabled:false
    });
    const key=await deriveShadowSubject(USER_A,PEPPER);
    h.db.prepare(`INSERT INTO billing_shadow_accounts
      (subject_hash,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?)`)
      .run(key,'under_review',1,2);
    const visible=await body(await handler(env));
    assert.equal(visible.accountStatus,'under_review');
    assert.equal(visible.credits,null);
    assert.equal(visible.billingReady,false);
    assert.doesNotMatch(JSON.stringify(visible),/a@secret|123456789|subject_hash/);
    assert.equal((await body(await handler(env,{user:{id:USER_B}}))).accountStatus,'not_enrolled');
    h.db.prepare('UPDATE billing_shadow_accounts SET status=? WHERE subject_hash=?').run('blocked',key);
    assert.equal((await body(await handler(env))).accountStatus,'blocked');
    const changed=await body(await handler(config(h.wrapper,{BOR_BILLING_SHADOW_PEPPER:OTHER_PEPPER})));
    assert.equal(changed.accountStatus,'not_enrolled');
    assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM billing_shadow_accounts').get().n,1);
  }finally{h.close()}
});

test('client identity headers cannot override the server-verified Google session',async()=>{
  const h=dbHarness();try{
    const key=await deriveShadowSubject(USER_A,PEPPER);
    h.db.prepare('INSERT INTO billing_shadow_accounts (subject_hash,status,created_at_ms,updated_at_ms) VALUES(?,?,?,?)')
      .run(key,'blocked',1,1);
    const result=await handler(config(h.wrapper),{
      user:{id:USER_B},
      headers:{'X-User-Id':USER_A,'X-Billing-Account':USER_A,'X-Forwarded-User':USER_A}
    });
    assert.equal(result.status,200);
    const data=await result.json();
    assert.equal(data.accountStatus,'not_enrolled');
    assert.equal(data.credits,null);
  }finally{h.close()}
});

test('repository production wiring invokes existing getSession but has no binding, secret or live checkout',()=>{
  const prod=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const configText=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
  assert.match(prod,/handleBillingShadowAccountRequest\(request, env, \{ getSession \}\)/);
  assert.match(prod,/url\.pathname === "\/api\/billing\/account"/);
  assert.doesNotMatch(configText,/BILLING_SHADOW_DB|BOR_BILLING_SHADOW_PEPPER|BOR_BILLING_SHADOW_ENABLED/);
  assert.doesNotMatch(configText,/bor-ai-billing-staging/);
  const schema=readFileSync(new URL('../staging/billing-shadow/0001_readonly_schema.sql',import.meta.url),'utf8');
  assert.match(schema,/CREATE TABLE billing_shadow_attestation/);
  assert.doesNotMatch(schema,/billing_credit_ledger|DUITKU_SANDBOX_API_KEY|CREATE TABLE users/);
});
