import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const blueprint = fs.readFileSync("render.yaml", "utf8");

test("Render Blueprint pins the isolated proof service to free manual deployment", () => {
  assert.ok(blueprint.includes("services:\n  - type: web\n"));
  assert.ok(blueprint.includes("    runtime: node\n"));
  assert.ok(blueprint.includes("    plan: free\n"));
  assert.ok(blueprint.includes("    region: oregon\n"));
  assert.ok(blueprint.includes("    branch: main\n"));
  assert.ok(blueprint.includes("    autoDeployTrigger: off\n"));
  assert.ok(blueprint.includes("    numInstances: 1\n"));
  assert.doesNotMatch(blueprint, /(?:starter|0\.5c-512mb|1c-2g|paid)/i);
});

test("Render Blueprint uses the reviewed entrypoint and a generated secret", () => {
  assert.ok(blueprint.includes("    buildCommand: npm ci --omit=dev --ignore-scripts\n"));
  assert.ok(blueprint.includes("    startCommand: node tools/egress-proxy/render/server.mjs\n"));
  assert.ok(blueprint.includes("    healthCheckPath: /health\n"));
  assert.ok(blueprint.includes("      - key: EGRESS_PROXY_TOKEN\n        generateValue: true\n"));
  assert.doesNotMatch(blueprint, /EGRESS_PROXY_TOKEN\s*:\s*\S+/);
  assert.ok(fs.existsSync("tools/egress-proxy/render/server.mjs"));
});
