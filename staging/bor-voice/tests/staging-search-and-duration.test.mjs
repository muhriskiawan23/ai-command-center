import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceSearch } from '../delegation.mjs';
import { createPrimaryVoice } from '../primary-voice.mjs';

test('voice search uses recent transcript, emits only cited answers, and spends at most three lookups', async () => {
  const queries = [];
  const replies = [];
  const receive = voiceSearch({
    signal: new AbortController().signal,
    async lookup(query) {
      queries.push(query);
      return queries.length === 2
        ? { answer: 'Unverified', sources: [{url:'http://example.test/'}] }
        : { answer: 'Sumber simulasi', sources: [
          {url:'https://fixture.example.org/source'}, {url:'https://username@fixture.example.org/'},
        ] };
    },
    send: message => replies.push(message),
  });
  const fragment = (delta, start, end) => receive({ type:'session.input_transcript.delta', delta, start_ms:start, end_ms:end });
  const delegate = id => receive({type:'session.delegation.created',offset_ms:50000,delegation:{id,target:'client'}});
  await fragment('Tidak relevan',0,10);
  await fragment('Cek keberangkatan',49000,49500);
  await fragment(' besok',49500,50000);
  await fragment('audio setelah permintaan',50001,50100);
  for (const id of ['item_01','item_01','item_02','item_03','item_04']) await delegate(id);
  assert.deepEqual(queries, Array(3).fill('Cek keberangkatan besok'));
  assert.deepEqual(replies.map(x=>x.delegation_id),['item_01','item_02','item_03']);
  assert.deepEqual(JSON.parse(replies[0].content),{
    answer:'Sumber simulasi',sources:['https://fixture.example.org/source'],
  });
  assert.equal(replies[1].content,'Pencarian belum menghasilkan jawaban yang dapat diverifikasi.');
});

test('one-minute Primary simulation requests close and keeps the latest usage if the receipt never arrives', context => {
  context.mock.timers.enable({apis:['Date','setTimeout'],now:1_000_000});
  class FakeSocket extends EventTarget {
    sent = [];
    send(body) { this.sent.push(JSON.parse(body)); }
    close() {}
    receive(body) { this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(body)})); }
  }
  const socket = new FakeSocket();
  const evidence = [];
  const final = [];
  const session = { id:'live_fixture_minute', model:'gpt-live-1.1' };
  const voice = createPrimaryVoice({socket,onEvidence:value=>evidence.push(value),onFinal:value=>final.push(value)});
  socket.receive({type:'session.started',session});
  for (const seconds of [10,20,30,40,50]) {
    context.mock.timers.tick(10_000);
    assert.equal(voice.appendAudio('AAAA'),true);
    socket.receive({type:'session.usage.updated',session,usage:{seconds}});
  }
  assert.equal(voice.getState(),'active');
  context.mock.timers.tick(9999);
  assert.equal(voice.getState(),'active');
  context.mock.timers.tick(1);
  assert.equal(voice.getState(),'closing');
  assert.equal(voice.appendAudio('AAAA'),false);
  assert.equal(socket.sent.filter(x=>x.type==='session.close').length,1);
  context.mock.timers.tick(15_000);
  assert.equal(final.length,1);
  assert.equal(final[0].confirmed,false);
  assert.equal(final[0].latestSeconds,50);
  assert.equal(final[0].usage,null);
  assert.equal(evidence.at(-1).latestSeconds,50);
});
