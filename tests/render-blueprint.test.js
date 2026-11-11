import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const blueprint = fs.readFileSync("render.yaml", "utf8");

test("Render Blueprint pins the isolated proof service to free manual deployment", () => {
  assert.match(blueprint, /^services:\\n  - type: web$/m);
  assert.match(blueprint, /^    runtime: node$/m);
  assert.match(blueprint, /^    plan: free$/m);
  assert.match(blueprint, /^    region: oregon$/m);
  assert.match(blueprint, /^    branch: main$/m);
  assert.match(blueprint, /^    autoDeployTrigger: off$/m);
  assert.match(blueprint, /^    numInstances: 1$/m);
  assert.doesNotMatch(blueprint, /(?:starter|0\\.5c-512mb|1c-2g|paid)/i);
});

test("Render Blueprint uses the reviewed entrypoint and a generated secret", () => {
  assert.match(blueprint, /^    buildCommand: npm ci --omit=dev --ignore-scripts$/m);
  assert.match(blueprint, /^    startCommand: node tools\\/egress-proxy\\/render\\/server\\.mjs$/m);
  assert.match(blueprint, /^    healthCheckPath: \\/health$/m);
  assert.match(blueprint, /^      - key: EGRESS_PROXY_TOKEN\\n        generateValue: true$/m);
  assert.doesNotMatch(blueprint, /EGRESS_PROXY_TOKEN\\s*:\\s*\\S+/);
  assert.ok(fs.existsSync("tools/egress-proxy/render/server.mjs"));
});
