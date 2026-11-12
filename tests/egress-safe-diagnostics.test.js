import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCliFailure } from '../tools/egress-proxy/runtime/safe-diagnostics.mjs';
test('deployment diagnostics return only fixed categories and numeric API codes', () => {
  const secret='sensitive-value-code:123456';
  const output=JSON.stringify(summarizeCliFailure(`Authorization: Bearer ${secret}\nrequest https://private.invalid/path failed: authentication error [code: 10000] VPC binding`, [secret]));
  assert.ok(!output.includes(secret));
  assert.ok(!output.includes('private.invalid'));
  assert.deepEqual(JSON.parse(output), {codes:[10000],categories:['authorization','vpc','binding']});
});
test('unknown diagnostics never echo arbitrary strings', () => {
  assert.deepEqual(summarizeCliFailure('super-secret-and-a-private-host'),{codes:[],categories:['unknown']});
});

test('ANSI-styled and JSON API codes are parsed without exposing error text', () => {
  assert.deepEqual(summarizeCliFailure('[code: \x1b[1m10000\x1b[0m] "code":10021 private.invalid'), {codes:[10000,10021],categories:['unknown']});
});
