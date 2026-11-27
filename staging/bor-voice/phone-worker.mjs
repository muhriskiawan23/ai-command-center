import { json } from '../../src/http.js';
import voiceClient from '../../public/voice-live.js';
import legacyPilot, { VoicePilot } from './live-worker.mjs';
import phoneClient from './phone-client.js';
import phonePage from './phone.html';
import { voiceAdmissionStatus } from './voice-admission.mjs';

const pageHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Permissions-Policy': 'microphone=(self), camera=(), display-capture=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};

const assets = new Map([
  ['/', { body: phonePage.replace('__PILOT_READY__', 'false'), type: 'text/html' }],
  ['/phone-client.js', { body: phoneClient, type: 'text/javascript' }],
  ['/voice-live.js', { body: voiceClient, type: 'text/javascript' }],
]);

export default {
  fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/api/voice/admission/status') {
      // Application session cookies are host-only. Keep session validation on the app.
      return voiceAdmissionStatus(request, env, {
        getSession: async () => { throw new Error('voice_auth_unbound'); },
        json,
      });
    }
    const asset = assets.get(path);
    if (!asset) return legacyPilot.fetch(request, env);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response(null, { status: 405, headers: { ...pageHeaders, Allow: 'GET, HEAD' } });
    }
    return new Response(request.method === 'HEAD' ? null : asset.body, {
      headers: { ...pageHeaders, 'Content-Type': asset.type + '; charset=utf-8' },
    });
  },
};

export { VoicePilot };
