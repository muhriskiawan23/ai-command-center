import { LiveVoice } from './voice-live.js';

const states = {
  connecting: 'Menghubungkan suara…',
  listening: 'Mendengarkan',
  closing: 'Menutup sesi suara…',
  closed: 'Sesi suara berakhir.',
  denied: 'Izin mikrofon ditolak.',
  error: 'Koneksi suara gagal.',
  timeout: 'Koneksi suara melewati batas waktu.',
};

export function setupVoicePreview({ exchange, prompt, attach, notice }) {
  const panel = document.querySelector('#voicePreview');
  const start = panel.querySelector('[data-voice-start]');
  const stop = panel.querySelector('[data-voice-stop]');
  const silence = panel.querySelector('[data-voice-silence]');
  const dictation = panel.querySelector('[data-voice-dictation]');
  const status = panel.querySelector('[role=status]');
  const audio = panel.querySelector('audio');
  const captions = {
    user: panel.querySelector('[data-voice-user]'),
    assistant: panel.querySelector('[data-voice-assistant]'),
  };
  const fragments = { user: [], assistant: [] };
  let capture;
  const live = new LiveVoice({
    exchange, audio,
    onState(state) {
      start.disabled = ['connecting', 'listening', 'closing'].includes(state);
      stop.disabled = !start.disabled || state === 'closing';
      silence.disabled = state !== 'listening';
      silence.setAttribute('aria-pressed', String(audio.muted));
      status.textContent = states[state];
    },
    onTranscript({ role, delta, start, end }) {
      const list = fragments[role];
      list.push({ delta, start, end });
      captions[role].textContent = list.toSorted((a, b) => a.start - b.start || a.end - b.end)
        .map(item => item.delta).join('').slice(-8000);
      dictation.disabled = !captions.user.textContent.trim();
    },
    onError(message) { status.textContent = message; },
  });

  start.addEventListener('click', () => {
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.RTCPeerConnection) {
      status.textContent = 'Percakapan suara tidak didukung browser ini.';
      return;
    }
    globalThis.BORVoiceChat?.stop();
    for (const role of Object.keys(captions)) {
      fragments[role].length = 0;
      captions[role].textContent = '';
    }
    dictation.disabled = true;
    void live.start();
  });
  stop.addEventListener('click', () => live.stop());
  silence.addEventListener('click', () => {
    live.silence(!audio.muted);
    silence.setAttribute('aria-pressed', String(audio.muted));
  });
  dictation.addEventListener('click', () => {
    const text = captions.user.textContent.trim();
    const separator = prompt.value && !/\s$/.test(prompt.value) ? ' ' : '';
    const addition = (separator + text).slice(0, Math.max(0, prompt.maxLength - prompt.value.length));
    prompt.value += addition;
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    prompt.focus();
  });

  const video = panel.querySelector('video');
  const snapshot = panel.querySelector('[data-voice-snapshot]');
  const stopCapture = panel.querySelector('[data-voice-stop-capture]');
  function endCapture() {
    capture?.stream?.getTracks().forEach(track => track.stop());
    capture = undefined;
    video.srcObject = null;
    video.hidden = true;
    snapshot.disabled = true;
    stopCapture.disabled = true;
  }
  async function startCapture(source) {
    endCapture();
    const current = { source };
    capture = current;
    stopCapture.disabled = false;
    try {
      const stream = source === 'camera' ?
        await navigator.mediaDevices.getUserMedia({ video: true, audio: false }) :
        await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      if (capture !== current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      current.stream = stream;
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (capture === current) endCapture();
      }, { once: true });
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      if (capture === current) snapshot.disabled = false;
    } catch {
      if (capture !== current) return;
      endCapture();
      notice('Kamera atau berbagi layar tidak tersedia, atau izinnya ditolak.');
    }
  }
  for (const source of ['camera', 'screen']) {
    const control = panel.querySelector('[data-voice-' + source + ']');
    const api = source === 'camera' ? 'getUserMedia' : 'getDisplayMedia';
    control.hidden = typeof navigator.mediaDevices?.[api] !== 'function';
    control.addEventListener('click', () => void startCapture(source));
  }
  stopCapture.addEventListener('click', endCapture);
  snapshot.addEventListener('click', () => {
    const current = capture;
    if (!current || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(blob => {
      if (capture !== current || !blob) return;
      endCapture();
      attach(new File([blob], current.source + '.jpg', { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.86);
  });

  const reset = () => {
    live.stop({ immediate: true });
    endCapture();
    for (const role of Object.keys(captions)) {
      fragments[role].length = 0;
      captions[role].textContent = '';
    }
    dictation.disabled = true;
  };
  window.addEventListener('pagehide', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  panel.hidden = false;
  return reset;
}
