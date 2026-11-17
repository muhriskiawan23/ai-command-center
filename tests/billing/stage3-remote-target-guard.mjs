// No network, no filesystem writes, and no provider calls.
// Pure safety gate for the MANUAL Stage 3 disposable Cloudflare D1 proof.
// Never treat a name alone as proof of remote database identity.
import assert from "node:assert/strict";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stage3Name=/^bor-ai-billing-sbx-stage3-[a-z0-9-]{6,40}$/;
const hexAccount=/^[a-f0-9]{32}$/i;

export function validateStage3RemoteTarget({
  name,id,accountId,token,productionDatabases=[],
  previousSandboxName=null,previousSandboxId=null
}={}){
  assert.match(name||"",stage3Name,
    "Only a separately provisioned stage3-prefixed disposable sandbox is allowed");
  assert.match(id||"",uuid,"Exact valid Stage 3 D1 UUID is required");
  assert.match(accountId||"",hexAccount,
    "Explicit limited-scope sandbox account identity is required");
  assert.ok(typeof token==="string"&&token.length>15,
    "Dedicated sandbox-only D1 token required");
  // The dispatcher MUST supply the existing Stage 2 sandbox's exact identity.
  // If either environment variable is absent, fail before any remote SQL.
  assert.match(previousSandboxName||"",
    /^bor-ai-billing-sbx-stage2(?:-[a-z0-9-]+)?$/,
    "Existing Stage 2 sandbox name required for reuse denial");
  assert.match(previousSandboxId||"",uuid,
    "Existing Stage 2 sandbox UUID required for reuse denial");
  assert.ok(Array.isArray(productionDatabases),
    "Production D1 binding inventory missing");
  assert.ok(!productionDatabases.some(x=>x?.database_id===id||x?.database_name===name),
    "Refusing a production D1 ID/name");
  assert.ok(id!==previousSandboxId && name!==previousSandboxName,
    "Refusing to reuse an existing Stage 2 sandbox database");
  return true;
}

// The CLI is only allowed to execute its generated temporary Wrangler config
// after the remote account's D1 inventory uniquely confirms ID *and* name.
// Reject duplicate/misleading entries, a changed identity, or a missing DB.
// This never authorizes data deletion or remote provisioning.
export function verifyStage3RemoteInventory({
  inventory,name,id,productionDatabases=[]
}={}){
  assert.ok(Array.isArray(inventory),"Complete D1 list array required");
  assert.ok(Array.isArray(productionDatabases),
    "Production D1 binding inventory missing");
  assert.match(name||"",stage3Name);
  assert.match(id||"",uuid);
  const byId=inventory.filter(x=>x&&(x.uuid===id||x.id===id));
  const byName=inventory.filter(x=>x&&x.name===name);
  assert.equal(byId.length,1,
    "The sandbox UUID must uniquely exist in D1 inventory");
  assert.equal(byName.length,1,
    "The sandbox name must uniquely exist in D1 inventory");
  assert.equal(byId[0],byName[0],
    "Database UUID/name mismatch; refusing remote D1 writes");
  const found=byId[0];
  if(found.uuid!==undefined&&found.id!==undefined)
    assert.equal(found.uuid,found.id,
      "Conflicting UUID/id fields in remote D1 inventory");
  assert.ok(!productionDatabases.some(x=>
    x?.database_id===id||x?.database_name===name),
    "Production D1 binding forbidden");
  return true;
}
