const transcriptTypes = {
  'session.input_transcript.delta': 'user',
  'session.output_transcript.delta': 'assistant',
};

function stopTracks(stream) {
  stream?.getTracks().forEach(track => track.stop());
}

function gatherIce(peer, signal) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve, reject) => {
    function finish(error) {
      peer.removeEventListener('icegatheringstatechange', update);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    }
    function abort() { finish(signal.reason); }
    function update() {
      if (peer.iceGatheringState === 'complete') finish();
    }
    peer.addEventListener('icegatheringstatechange', update);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else update();
  });
}

export class LiveVoice {
  #run;

  constructor({ exchange, audio, onState, onTranscript, onError }) {
    Object.assign(this, { exchange, audio, onState, onTranscript, onError });
  }

  async start() {
    if (this.#run) return;
    const run = { abort: new AbortController(), seen: new Set() };
    this.#run = run;
    this.onState('connecting');
    run.connectTimer = setTimeout(() => this.#close(run, 'timeout'), 20000);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.#run !== run) {
        stopTracks(stream);
        return;
      }
      run.stream = stream;
      const peer = new RTCPeerConnection();
      run.peer = peer;
      peer.addEventListener('track', ({ track }) => {
        if (this.#run !== run || track.kind !== 'audio') return;
        this.audio.srcObject = new MediaStream([track]);
        this.audio.play().catch(() => {
          if (this.#run === run) this.onError('Tekan Putar pada pemutar suara.');
        });
      });
      peer.addEventListener('connectionstatechange', () => {
        if (peer.connectionState === 'failed') this.#close(run, 'error');
      });
      for (const track of stream.getAudioTracks()) {
        track.enabled = false;
        peer.addTrack(track, stream);
      }
      const events = peer.createDataChannel('oai-events');
      run.events = events;
      events.addEventListener('message', ({ data }) => this.#receive(run, data));
      events.addEventListener('close', () => this.#close(run, 'closed'));
      await peer.setLocalDescription(await peer.createOffer());
      await gatherIce(peer, run.abort.signal);
      const { answerSdp } = await this.exchange(peer.localDescription.sdp, run.abort.signal);
      if (this.#run !== run) return;
      await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    } catch (error) {
      this.#close(run, error.name === 'NotAllowedError' ? 'denied' : 'error');
    }
  }

  #receive(run, data) {
    if (this.#run !== run || typeof data !== 'string' || data.length > 32768) return;
    let event;
    try { event = JSON.parse(data); } catch { return; }
    if (event?.type === 'session.closed') return this.#close(run, 'closed');
    if (event?.type === 'error') return this.onError('Sesi suara melaporkan kesalahan.');
    if (event?.type === 'session.started' && !run.ready && !run.stopping) {
      run.ready = true;
      clearTimeout(run.connectTimer);
      run.stream.getAudioTracks().forEach(track => { track.enabled = true; });
      this.onState('listening');
    }
    if (!run.ready || run.stopping || !Object.hasOwn(transcriptTypes, event?.type)) return;
    const { event_id: id, delta, start_ms: start, end_ms: end } = event;
    if (typeof id !== 'string' || id.length > 128 || run.seen.has(id) || run.seen.size >= 2500 ||
        typeof delta !== 'string' || delta.length > 4096 ||
        !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return;
    run.seen.add(id);
    this.onTranscript({ role: transcriptTypes[event.type], delta, start, end });
  }

  silence(silent) {
    this.audio.muted = silent;
  }

  stop({ immediate = false } = {}) {
    const run = this.#run;
    if (!run) return;
    stopTracks(run.stream);
    this.audio.pause();
    this.audio.srcObject = null;
    if (immediate || !run.ready || run.events.readyState !== 'open') {
      this.#close(run, 'closed');
      return;
    }
    if (run.stopping) return;
    run.stopping = true;
    try {
      run.events.send(JSON.stringify({ type: 'session.close', event_id: crypto.randomUUID() }));
    } catch {
      this.#close(run, 'closed');
      return;
    }
    this.onState('closing');
    run.closeTimer = setTimeout(() => this.#close(run, 'closed'), 1500);
  }

  #close(run, state) {
    if (this.#run !== run) return;
    this.#run = undefined;
    run.abort.abort();
    clearTimeout(run.connectTimer);
    clearTimeout(run.closeTimer);
    stopTracks(run.stream);
    run.peer?.close();
    this.audio.pause();
    this.audio.srcObject = null;
    this.audio.muted = false;
    this.onState(state);
  }
}
