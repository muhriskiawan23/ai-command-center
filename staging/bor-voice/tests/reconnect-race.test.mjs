import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveVoice } from '../../../public/voice-live.js';

function fixture(t, options = {}) {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldPeer = globalThis.RTCPeerConnection;
  const oldWindow = globalThis.window;
  const window = globalThis.window = new EventTarget();
  const tracks = [], peers = [], states = [], exchanges = [];
  let deferred;
  class Peer extends EventTarget {
    iceGatheringState = 'complete';
    channel = new EventTarget();
    constructor(){super();peers.push(this);this.channel.readyState='open';this.channel.send=()=>{};}
    addTrack(){}
    createDataChannel(){return this.channel;}
    createOffer(){return options.deferOffer ? new Promise(resolve=>{deferred=resolve;}) : {sdp:'v=0\r\n'};}
    setLocalDescription(o){this.localDescription=o;}
    setRemoteDescription(o){this.remoteDescription=o;}
    close(){this.closed=true;this.channel.dispatchEvent(new Event('close'));}
  }
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true,mediaDevices:{getUserMedia:async()=>{const track={enabled:true,stop(){this.stopped=true;}};tracks.push(track);return {getTracks:()=>[track],getAudioTracks:()=>[track]};}}}});
  globalThis.RTCPeerConnection=Peer;
  const voice = new LiveVoice({audio:{pause(){},muted:false},exchange:async(sdp,signal)=>{exchanges.push({sdp,signal});return {answerSdp:sdp};},onState:s=>states.push(s),onTranscript:assert.fail,onError:assert.fail});
  t.after(()=>{voice.stop({immediate:true});Object.defineProperty(globalThis,'navigator',oldNavigator);globalThis.RTCPeerConnection=oldPeer;globalThis.window=oldWindow;});
  return {voice,window,tracks,peers,states,exchanges,resolveOffer:()=>deferred({sdp:'v=0\r\n'})};
}
test('offline releases mic and peer immediately, then online permits clean explicit new run',async t=>{
  const f=fixture(t);await f.voice.start();
  f.window.dispatchEvent(new Event('offline'));
  assert.equal(f.tracks[0].stopped,true);assert.equal(f.peers[0].closed,true);assert.equal(f.states.at(-1),'error');
  assert.equal(f.exchanges.length,1);f.window.dispatchEvent(new Event('online'));assert.equal(f.exchanges.length,1);
  await f.voice.start();assert.equal(f.exchanges.length,2);assert.equal(f.tracks[1].stopped,undefined);
  f.peers[0].channel.dispatchEvent(new Event('close'));assert.equal(f.states.at(-1),'connecting');
});
test('cancelled offer never reaches session exchange after delayed createOffer',async t=>{
  const f=fixture(t,{deferOffer:true});const pending=f.voice.start();await Promise.resolve();f.voice.stop({immediate:true});f.resolveOffer();await pending;
  assert.equal(f.exchanges.length,0);assert.equal(f.tracks[0].stopped,true);
});
