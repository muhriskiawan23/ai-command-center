import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync("tools/egress-proxy/verify-hosted.mjs", "utf8");

test("hosted proof is fixed to synthetic HTTPS and emits no content", () => {
  assert.match(source, /https:\/\/example\.com\//);
  assert.match(source, /selectedPeerIp/);
  assert.match(source, /observedPeerIp/);
  assert.match(source, /tlsIdentityVerified/);
  assert.match(source, /incorrect authentication/);
  assert.match(source, /http:\/\/127\.0\.0\.1\//);
  assert.match(source, /https:\/\/\[::1\]\//);
  assert.match(source, /http:\/\/169\.254\.169\.254\//);
  assert.match(source, /unsafe_ip_literal/);
  assert.match(source, /AbortSignal\.timeout\(90_000\)/);
  assert.doesNotMatch(source, /bodyBase64/);
  assert.doesNotMatch(source, /console\.log\([^)]*payload/);
  assert.doesNotMatch(source, /process\.argv/);
});
