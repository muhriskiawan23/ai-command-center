import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceSearch } from '../delegation.mjs';

const fragment = (delta, start, end) => ({
  type: 'session.input_transcript.delta', delta, start_ms: start, end_ms: end,
});
const request = id => ({
  type: 'session.delegation.created', offset_ms: 100, delegation: { id, target: 'client' },
});

test('voice search forwards recent user context once and returns sourced results to the matching delegation', async () => {
  const queries = [];
  const messages = [];
  const signal = new AbortController().signal;
  const receive = voiceSearch({
    signal,
    lookup: async (query, options) => {
      assert.equal(options.signal, signal);
      queries.push(query);
      return { answer: 'Hasil simulasi', sources: [{ url: 'https://example.com/source' }, { url: 'javascript:void(0)' }] };
    },
    send: event => messages.push(event),
  });
  await receive(fragment(' berapa?', 50, 95));
  await receive(fragment('Suhu Jakarta', 20, 49));
  await receive(fragment('Pertanyaan berikut', 101, 102));
  await receive(request('item_1'));
  await receive(request('item_1'));
  assert.deepEqual(queries, ['Suhu Jakarta berapa?']);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].delegation_id, 'item_1');
  assert.deepEqual(JSON.parse(messages[0].content), { answer: 'Hasil simulasi', sources: ['https://example.com/source'] });
});

test('cancel during lookup drops a late result and never delegates empty context', async () => {
  const controller = new AbortController();
  let calls = 0;
  let result;
  const receive = voiceSearch({
    signal: controller.signal,
    lookup: () => {
      calls++;
      return new Promise(resolve => { result = resolve; });
    },
    send: () => assert.fail('late result forwarded'),
  });
  await receive(request('item_1'));
  assert.equal(calls, 0);
  await receive(fragment('Cuaca', 0, 90));
  const pending = receive(request('item_2'));
  await receive(request('item_3'));
  assert.equal(calls, 1);
  controller.abort();
  result({ answer: 'Hasil simulasi', sources: [{ url: 'https://example.com/' }] });
  await pending;
});
