import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenAILive } from '../openai-live.mjs';

const offer = 'v=0\r\n';
const finalEvent = {
  type: 'session.closed',
  session: { id: 'live_room', model: 'gpt-live-1.1' },
  usage: { seconds: 27 },
};

test('creates the documented WebRTC session with a server-side key and no redirect', async () => {
  const live = createOpenAILive({
    apiKey: 'fixture',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/live/sessions');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer fixture');
      const request = JSON.parse(options.body);
      assert.equal(request.session.model, 'gpt-live-1.1');
      assert.equal(request.session.store, false);
      assert.deepEqual(request.transport, { type: 'webrtc', sdp: offer });
      return Response.json({ session: { id: 'live_room' }, transport: request.transport }, { status: 201 });
    },
  });
  assert.deepEqual(await live.create(offer), {
    session: { id: 'live_room' },
    transport: { type: 'webrtc', sdp: offer },
  });
  await assert.rejects(live.create('invalid offer'), /invalid_offer/);
});

test('does not retry failed or ambiguous paid session creation', async () => {
  let attempts = 0;
  const live = createOpenAILive({
    apiKey: 'fixture',
    fetchImpl: async () => {
      attempts++;
      return Response.json({ detail: 'provider-only message' }, { status: 503 });
    },
  });
  await assert.rejects(live.create(offer), { message: 'live_create_failed' });
  assert.equal(attempts, 1);
});

class Socket extends EventTarget {
  accept() { this.accepted = true; }
  send(data) { this.sent = JSON.parse(data); }
  close() { this.dispatchEvent(new Event('close')); }
  receive(event) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
  }
}

test('uses the authenticated sideband and settles only on matching final usage', async () => {
  const socket = new Socket();
  const live = createOpenAILive({
    apiKey: 'fixture',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/live/sessions/live_room/attach');
      assert.equal(options.headers.Authorization, 'Bearer fixture');
      assert.equal(options.headers.Upgrade, 'websocket');
      return { status: 101, webSocket: socket };
    },
  });
  const channel = await live.attach('live_room');
  assert.equal(socket.accepted, true);
  channel.requestClose();
  assert.equal(socket.sent.type, 'session.close');

  socket.receive({ ...finalEvent, session: { ...finalEvent.session, id: 'live_other' } });
  socket.receive({ ...finalEvent, session: { ...finalEvent.session, model: 'gpt-live-1' } });
  socket.receive({ ...finalEvent, usage: { seconds: -1 } });
  socket.receive(finalEvent);
  assert.deepEqual(await channel.final, finalEvent);
});

test('a sideband disconnect cannot confirm billing', async () => {
  const socket = new Socket();
  const live = createOpenAILive({
    apiKey: 'fixture',
    fetchImpl: async () => ({ status: 101, webSocket: socket }),
  });
  const channel = await live.attach('live_room');
  channel.disconnect();
  assert.equal(await channel.final, null);
});
