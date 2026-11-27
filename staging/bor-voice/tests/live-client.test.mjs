import assert from 'node:assert/strict';
import test from 'node:test';
import { LiveVoice } from '../../../public/voice-live.js';

test('live client gates the microphone, handles caption events, and releases media after close', async t => {
  const tracks = [{ enabled: true, stop() { this.stopped = true; } }];
  const stream = { getTracks: () => tracks, getAudioTracks: () => tracks };
  const sent = [];
  let peer;
  class Channel extends EventTarget {
    readyState = 'open';
    send(data) { sent.push(JSON.parse(data)); }
    receive(event) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
  }
  class Peer extends EventTarget {
    iceGatheringState = 'complete';
    channel = new Channel();
    constructor() { super(); peer = this; }
    addTrack() {}
    createDataChannel(label) { assert.equal(label, 'oai-events'); return this.channel; }
    createOffer() { return { type: 'offer', sdp: 'v=0\r\n' }; }
    setLocalDescription(offer) { this.localDescription = offer; }
    setRemoteDescription(answer) { this.remoteDescription = answer; }
    close() { this.closed = true; }
  }
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getUserMedia: async () => stream,
  } } });
  globalThis.RTCPeerConnection = Peer;
  t.after(() => {
    Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    delete globalThis.RTCPeerConnection;
  });

  const states = [];
  const captions = [];
  const audio = { muted: false, pause() {} };
  const exchange = async (sdp, signal) => {
    assert.equal(sdp, 'v=0\r\n');
    assert.equal(signal.aborted, false);
    assert.equal(tracks[0].enabled, false);
    return { answerSdp: 'v=0\r\n' };
  };
  const voice = new LiveVoice({
    exchange, audio, onState: state => states.push(state),
    onTranscript: caption => captions.push(caption), onError: assert.fail,
  });
  await voice.start();
  const caption = { type: 'session.input_transcript.delta', event_id: 'one', delta: 'Halo', start_ms: 0, end_ms: 10 };
  peer.channel.receive(caption);
  assert.deepEqual(captions, []);
  peer.channel.receive({ type: 'session.started' });
  assert.equal(tracks[0].enabled, true);
  peer.channel.receive(caption);
  peer.channel.receive(caption);
  peer.channel.receive({ ...caption, event_id: 'two', start_ms: 11, end_ms: 10 });
  assert.deepEqual(captions, [{ role: 'user', delta: 'Halo', start: 0, end: 10 }]);
  voice.silence(true);
  assert.equal(audio.muted, true);
  voice.stop();
  assert.equal(tracks[0].stopped, true);
  assert.equal(sent[0].type, 'session.close');
  assert.equal(peer.closed, undefined);
  peer.channel.receive({ type: 'session.closed' });
  assert.deepEqual(states, ['connecting', 'listening', 'closing', 'closed']);
  assert.equal(peer.closed, true);
  assert.equal(audio.srcObject, null);
  assert.equal(audio.muted, false);
});

test('closing while the permission dialog is open discards late microphone access', async t => {
  let permit;
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getUserMedia: () => new Promise(resolve => { permit = resolve; }),
  } } });
  t.after(() => Object.defineProperty(globalThis, 'navigator', navigatorDescriptor));

  const states = [];
  const voice = new LiveVoice({
    exchange: () => assert.fail('closed session created a peer'),
    audio: { pause() {} },
    onState: state => states.push(state),
    onTranscript: assert.fail,
    onError: assert.fail,
  });
  const starting = voice.start();
  voice.stop({ immediate: true });
  let stopped = false;
  permit({ getTracks: () => [{ stop() { stopped = true; } }] });
  await starting;
  assert.equal(stopped, true);
  assert.deepEqual(states, ['connecting', 'closed']);
});
