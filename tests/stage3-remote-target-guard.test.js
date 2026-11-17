import test from "node:test";
import assert from "node:assert/strict";
import {
  validateStage3RemoteTarget,verifyStage3RemoteInventory
} from "./billing/stage3-remote-target-guard.mjs";

const name="bor-ai-billing-sbx-stage3-proof-01";
const id="11111111-1111-4111-8111-111111111111";
const token="test-only-not-a-real-secret";
const accountId="1234567890abcdef1234567890abcdef";
const prodId="d71231a9-9a04-471c-b904-d1bc843940aa";
const productionDatabases=[{database_id:prodId,database_name:"bor-ai-chat"}];
const inputs={name,id,accountId,token,productionDatabases,
  previousSandboxName:"bor-ai-billing-sbx-stage2-clean-01",
  previousSandboxId:"02907886-d55c-4194-9c45-39996a834c6c"};

test("operator-created unique Stage 3 target can pass pure no-network preflight",()=>{
  assert.equal(validateStage3RemoteTarget(inputs),true);
  assert.equal(verifyStage3RemoteInventory({
    name,id,productionDatabases,inventory:[{uuid:id,name}]
  }),true);
});

test("past Stage 2 DB and non-stage3 names are denied before any network access",()=>{
  for(const bad of [
    "bor-ai-billing-sbx-stage2-clean-01",
    "bor-ai-billing-sbx-stage2",
    "bor-ai-chat",
    "bor-ai-billing-sbx-stage3-x",
    "bor-ai-billing-sbx-stage3-../../prod",
    ""
  ])assert.throws(()=>validateStage3RemoteTarget({...inputs,name:bad}),
    /stage3-prefixed disposable sandbox/);
});

test("invalid UUIDs, malformed account identity or missing sandbox secret fail closed",()=>{
  const changes=[
    {id:"nonsense"},
    {id:prodId,productionDatabases:[{database_id:prodId,database_name:"bor-ai-chat"}]},
    {accountId:"nope"},
    {token:""},
    {token:null},
    {id:inputs.previousSandboxId,previousSandboxName:name,
      previousSandboxId:inputs.previousSandboxId}
  ];
  for(const change of changes)
    assert.throws(()=>validateStage3RemoteTarget({...inputs,...change}),
      /UUID|identity|token|required|production D1|Stage 2 sandbox/);
});

test("production database name or ID is rejected even under a stage3-looking alias",()=>{
  assert.throws(()=>validateStage3RemoteTarget({...inputs,
    productionDatabases:[{database_id:prodId,database_name:name}]}),
    /production D1/);
  assert.throws(()=>validateStage3RemoteTarget({...inputs,
    productionDatabases:[{database_id:id,database_name:"bor-ai-chat"}]}),
    /production D1/);
});

test("an explicit old-sandbox name/ID cannot become a new Stage 3 target",()=>{
  assert.throws(()=>validateStage3RemoteTarget({...inputs,previousSandboxName:name}),
    /Stage 2 sandbox/);
  assert.throws(()=>validateStage3RemoteTarget({...inputs,previousSandboxId:id}),
    /Stage 2 sandbox/);
});

test("D1 inventory must uniquely match BOTH UUID and name before SQL",()=>{
  const valid={name,id,productionDatabases};
  const mismatches=[
    [],
    [{uuid:id,name:"wrong-name"}],
    [{uuid:"22222222-2222-4222-8222-222222222222",name}],
    [{uuid:id,name:"wrong-name"},
      {uuid:"22222222-2222-4222-8222-222222222222",name}],
    [{uuid:id,name},{uuid:id,name:"duplicate-id"}],
    [{uuid:id,name},{uuid:"22222222-2222-4222-8222-222222222222",name}]
  ];
  for(const inventory of mismatches)
    assert.throws(()=>verifyStage3RemoteInventory({...valid,inventory}),
      /uniquely|mismatch/);
});

test("cloud inventory absent, invalid, or with a production identity fails closed",()=>{
  assert.throws(()=>verifyStage3RemoteInventory({
    name,id,productionDatabases,inventory:null
  }),/Complete D1 list array/);
  assert.throws(()=>verifyStage3RemoteInventory({
    name,id,inventory:[{uuid:id,name}],
    productionDatabases:[{database_id:id,database_name:"bor-ai-chat"}]
  }),/Production D1 binding forbidden/);
  assert.throws(()=>verifyStage3RemoteInventory({
    name,id,inventory:[{uuid:id,name}],productionDatabases:null
  }),/Production D1 binding inventory missing/);
});

test("guards do not create or modify financial files, payments, or D1 state",()=>{
  // Pure predicates receive literal objects and have no D1 client or env.
  const payload={...inputs};
  const inventory=[{uuid:id,name}];
  const before=JSON.stringify({payload,inventory});
  validateStage3RemoteTarget(payload);
  verifyStage3RemoteInventory({...payload,inventory});
  assert.equal(JSON.stringify({payload,inventory}),before);
});

test("missing Stage 2 identity must fail closed before remote SQL even for valid new database",()=>{
  for(const broken of [
    {previousSandboxName:undefined},
    {previousSandboxName:""},
    {previousSandboxId:undefined},
    {previousSandboxId:""},
    {previousSandboxName:"not-a-stage2-sandbox"},
    {previousSandboxId:"invalid-id"}
  ]){
    assert.throws(()=>validateStage3RemoteTarget({...inputs,...broken}),
      /Existing Stage 2 sandbox/);
  }
});

test("inconsistent UUID and id on the same Cloudflare inventory row are rejected",()=>{
  const wrong={uuid:id,
    id:"22222222-2222-4222-8222-222222222222",name};
  assert.throws(()=>verifyStage3RemoteInventory({
    inventory:[wrong],name,id,productionDatabases
  }),/Conflicting UUID\/id fields/);
  assert.equal(verifyStage3RemoteInventory({
    inventory:[{uuid:id,id,name}],name,id,productionDatabases
  }),true);
});
