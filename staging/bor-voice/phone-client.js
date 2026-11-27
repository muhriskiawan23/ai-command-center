import { LiveVoice } from './voice-live.js';

const start = document.querySelector('#start');
const stop = document.querySelector('#stop');
const status = document.querySelector('#status');
const audio = document.querySelector('#speaker');
const userCaption = document.querySelector('#user-caption');
const assistantCaption = document.querySelector('#assistant-caption');

const ready = document.body.dataset.ready === 'true';
const supported = Boolean(navigator.mediaDevices?.getUserMedia && globalThis.RTCPeerConnection);
const states = {
  connecting: 'Menghubungkan suara…',
  listening: 'Sesi aktif. Mulai bicara.',
  closing: 'Menutup sesi…',
  closed: 'Sesi selesai.',
  denied: 'Izin mikrofon ditolak. Periksa pengaturan situs.',
  timeout: 'Koneksi suara melewati batas waktu.',
  error: 'Koneksi suara gagal.',
};
let exchangeError;
let rejected;
let offered = false;
let polling;
let busy = false;
let permitted = false;
let suspended = false;
let generation = 0;
const recoveryMessages = {
  pilot_session_pending: 'Sedang memeriksa sesi sebelumnya. Tunggu sebentar.',
  pilot_session_unconfirmed: 'Status sesi sebelumnya belum bisa dipastikan. Jatah masih ditahan.',
  pilot_budget_used: 'Jatah sesi uji sudah terpakai.',
};

function cancelCheck() {
  generation++;
  clearTimeout(polling);
  polling = undefined;
  permitted = false;
  start.disabled = true;
}
function checkRecovery(readyMessage = 'Sesi bisa dicoba lagi. Tekan Mulai ngobrol.') {
  if (!ready || !supported || busy || suspended || polling != null) return;
  const ticket = ++generation;
  permitted = false;
  start.disabled = true;
  status.textContent = 'Sedang memeriksa jatah sesi…';
  let checks = 0;
  const update = async () => {
    try {
      const response = await fetch('/api/voice/session/status', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (ticket !== generation || busy || suspended) return;
      if (response.ok) {
        const { state } = await response.json();
        if (ticket !== generation || busy || suspended) return;
        if (state === 'available') {
          polling = undefined;
          permitted = navigator.onLine !== false;
          start.disabled = !permitted;
          status.textContent = permitted ? readyMessage : 'Internet terputus. Sambungkan kembali.';
          return;
        }
        if (state === 'pilot_session_unconfirmed' || state === 'pilot_budget_used') {
          polling = undefined;
          status.textContent = recoveryMessages[state];
          return;
        }
        if (state === 'pilot_session_pending') status.textContent = recoveryMessages[state];
        else status.textContent = 'Status jatah belum diketahui. Tombol masih dikunci.';
      } else {
        status.textContent = 'Status jatah belum tersedia. Tombol masih dikunci.';
      }
    } catch {
      if (ticket !== generation || busy || suspended) return;
      status.textContent = 'Koneksi atau status jatah belum tersedia. Tombol masih dikunci.';
    }
    if (ticket !== generation || busy || suspended) return;
    if (++checks >= 30) {
      polling = undefined;
      status.textContent = 'Status jatah belum siap. Muat ulang halaman untuk memeriksa lagi.';
      return;
    }
    polling = setTimeout(update, 2500);
  };
  polling = setTimeout(update, 0);
}
window.addEventListener('offline', () => {
  if (!busy) { cancelCheck(); status.textContent = 'Internet terputus. Sambungkan kembali.'; }
});
window.addEventListener('online', () => checkRecovery());
window.addEventListener('pagehide', () => { suspended = true; cancelCheck(); });
window.addEventListener('pageshow', event => {
  if (event.persisted) { suspended = false; checkRecovery(); }
});

const live = new LiveVoice({
  audio,
  async exchange(sdp, signal) {
    offered = true;
    const response = await fetch('/api/voice/session', {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/sdp' },
      body: sdp,
      signal,
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      rejected = ['openai_access_denied', 'openai_usage_limited', 'openai_offer_rejected'].includes(failure?.error);
      exchangeError = {
        openai_access_denied: 'OpenAI menolak key atau izin Live.',
        openai_usage_limited: 'OpenAI membatasi penggunaan proyek.',
        openai_offer_rejected: 'OpenAI menolak konfigurasi sesi suara.',
        openai_connect_timeout: 'OpenAI belum merespons saat membuka sesi.',
      }[failure?.error] ?? recoveryMessages[failure?.error] ?? {
        409: 'Jatah sesi uji sudah terpakai.',
        503: 'Percakapan GPT-Live belum aktif.',
      }[response.status];
      throw new Error('voice_exchange_failed');
    }
    return response.json();
  },
  onState(state) {
    busy = ['connecting', 'listening', 'closing'].includes(state);
    start.disabled = true;
    stop.disabled = !busy || state === 'closing';
    status.textContent = state === 'error' && exchangeError ? exchangeError : states[state];
    if (!busy) {
      checkRecovery(state === 'error' && exchangeError ? exchangeError + ' Coba lagi jika sudah siap.' : undefined);
    }
  },
  onTranscript({ role, delta }) {
    const caption = role === 'user' ? userCaption : assistantCaption;
    caption.textContent = (caption.textContent + delta).slice(-4000);
  },
  onError(message) {
    status.textContent = message;
  },
});

document.querySelector('#controls').hidden = !ready;
if (ready) {
  status.textContent = supported ? 'Tekan Mulai ngobrol untuk memulai satu sesi uji.' : 'Coba buka halaman ini di Chrome atau Safari.';
  start.disabled = true;
  if (supported) checkRecovery('Tekan Mulai ngobrol untuk memulai satu sesi uji.');
}

start.addEventListener('click', () => {
  if (!ready || !supported || busy || !permitted || start.disabled || navigator.onLine === false) return;
  cancelCheck();
  exchangeError = undefined;
  offered = false;
  rejected = false;
  userCaption.textContent = '';
  assistantCaption.textContent = '';
  void live.start();
});
stop.addEventListener('click', () => live.stop());
window.addEventListener('pagehide', () => live.stop({ immediate: true }));
