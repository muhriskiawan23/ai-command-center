import test from 'node:test';
import assert from 'node:assert/strict';
import { safeError } from '../src/safe-error.js';
import fs from 'node:fs';
test('operational errors exclude message, stack, URL, token and custom properties', () => {
  const value = Object.assign(new Error('user-secret https://private.invalid/?token=credential'), { token: 'credential', response: 'private-body' });
  assert.deepEqual(safeError(value), { name: 'Error' });
  assert.doesNotMatch(JSON.stringify(safeError(value)), /credential|private|user-secret|stack|message/);
  value.name = 'user-secret';
  assert.deepEqual(safeError(value), { name: 'UnknownError' });
});
test('non-errors and throwing name getters cannot reach logs or break error handling', () => {
  assert.deepEqual(safeError('private-data'), { name: 'UnknownError' });
  assert.deepEqual(safeError({ get name() { throw Error('private-data'); } }), { name: 'UnknownError' });
});
test('application source does not log bare caught errors as objects', () => {
  for (const file of fs.readdirSync('src').filter(file => file.endsWith('.js'))) {
    const text = fs.readFileSync('src/' + file, 'utf8');
    assert.doesNotMatch(text, /console\.(?:error|warn)\("[^"\n]*",\s*(?:error|err|lookupError|sendError)\s*\)/, file);
  }
});

test('a changing error-name getter cannot bypass the fixed-name allowlist', () => {
  let reads = 0;
  assert.deepEqual(safeError({ get name() { return ++reads === 1 ? 'Error' : 'private-secret'; } }), { name: 'Error' });
  assert.equal(reads, 1);
});
