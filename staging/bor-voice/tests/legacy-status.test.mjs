import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { VoicePilot } from '../live-worker.mjs';

const origin = 'https://fixture.invalid';

test('reading legacy status preserves the unresolved reservation and exposes no session identity', async () => {
  let reads = 0;
  const attempt = {
    id: 'live_fixture',
    deadline: Date.now() - 30_000,
    reservedMicrousd: 100_000,
    reconciliation: 'attach_failed',
    recoveryV1: { state: 'attach_http_503' },
  };
  const pilot = new VoicePilot({
    storage: {
      async get(key) {
        assert.equal(key, 'attempt');
        reads++;
        return attempt;
      },
    },
  }, {});
  const env = {
    VOICE_PILOT: {
      getByName(name) {
        assert.equal(name, 'bor-ai-voice-pilot');
        return { fetch: url => pilot.fetch(new Request(url)) };
      },
    },
  };
  for (let i = 0; i < 2; i++) {
    const result = await worker.fetch(new Request(origin + '/api/voice/session/status'), env);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(await result.json(), {
      state: 'pilot_session_unconfirmed',
      reconciliation: 'attach_failed',
      recovery: 'attach_http_503',
    });
  }
  assert.equal(reads, 2);
  assert.equal(attempt.reservedMicrousd, 100_000);
});

test('disabled admission cannot reach storage at either entry point', async () => {
  const post = path => new Request(origin + path, {
    method: 'POST',
    headers: { Origin: origin },
  });
  const env = {
    BOR_VOICE_PAID_ENABLED: 'true',
    VOICE_PILOT: { getByName() { assert.fail('Paid path reached the ledger'); } },
  };
  assert.equal((await worker.fetch(post('/api/voice/session'), env)).status, 403);
  assert.equal((await worker.fetch(post('/api/voice/session/status'), env)).status, 405);
  assert.equal((await worker.fetch(post('/operator-rearm'), env)).status, 404);
  const pilot = new VoicePilot({ storage: {} }, env);
  assert.equal((await pilot.fetch(post('/session'))).status, 403);
  assert.equal((await pilot.fetch(post('/operator-rearm'))).status, 404);
});
