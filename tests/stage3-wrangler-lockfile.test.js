import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const manifest=JSON.parse(readFileSync(
  new URL("./billing/stage3-wrangler-lock/package.json",import.meta.url),"utf8"));
const lock=JSON.parse(readFileSync(
  new URL("./billing/stage3-wrangler-lock/package-lock.json",import.meta.url),"utf8"));
const runner=readFileSync(
  new URL("./billing/stage3-d1-proof.mjs",import.meta.url),"utf8");

test("remote sandbox Wrangler manifest and npm lock match exact approved CLI version",()=>{
  const target="4.160.0";
  assert.equal(manifest.private,true);
  assert.equal(manifest.devDependencies.wrangler,target);
  assert.equal(lock.lockfileVersion,3);
  assert.equal(lock.packages[""].devDependencies.wrangler,target);
  assert.equal(lock.packages["node_modules/wrangler"].version,target);
  assert.ok(runner.includes('const pinnedVersion="'+target+'"'));
  assert.equal(Object.keys(manifest.devDependencies).length,1);
});

test("all registry entries use https npm registry and SHA-512 integrity",()=>{
  const all=Object.entries(lock.packages);
  assert.ok(all.length>=10,"Incomplete registry dependency tree");
  for(const [name,pkg] of all){
    if(!name)continue;
    assert.match(pkg.resolved||"",/^https:\/\/registry\.npmjs\.org\/[^\s]+$/);
    assert.match(pkg.integrity||"",/^sha512-[A-Za-z0-9+/]+={0,2}$/);
  }
  assert.equal(new Set(all.map(([n])=>n)).size,all.length);
});

test("remote Wrangler lock is separate from production app dependencies",()=>{
  assert.equal(manifest.name,"bor-ai-stage3-d1-proof-wrangler");
  assert.deepEqual(Object.keys(lock.packages[""].devDependencies),["wrangler"]);
  assert.equal(lock.packages[""].name,manifest.name);
  assert.equal(lock.packages[""].version,manifest.version);
  assert.equal(lock.name,manifest.name);
  assert.equal(lock.version,manifest.version);
});
