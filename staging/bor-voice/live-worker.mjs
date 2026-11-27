import { closeExistingSession } from './provider-hangup.mjs';
import { json } from '../../src/http.js';
import { validLiveId } from './live-offer.mjs';
import { createOpenAILive } from './openai-live.mjs';

const pilotPath = '/api/voice/session';
const budgetMicrousd = 500_000;
const maximumSeconds = 585;
const defaultSessionSeconds = 60;
const longestPilotSeconds = 300;
const retryDelayMs = 5_000;
const maxCloseRequests = 3;
const maxSdpBytes = 65_536;

function pilotDurationSeconds(env) {
  return Number(env.BOR_VOICE_PILOT_SECONDS ?? defaultSessionSeconds);
}

function budgetVerified(env) {
  const seconds = Number(env.BOR_VOICE_VERIFIED_PROVIDER_MAX_SECONDS);
  const duration = pilotDurationSeconds(env);
  return env.BOR_VOICE_PAID_ENABLED === 'true' &&
    Number.isSafeInteger(seconds) && seconds > 0 && seconds <= maximumSeconds &&
    Number.isSafeInteger(duration) && duration > 0 && duration <= Math.min(seconds, longestPilotSeconds) &&
    typeof env.BOR_VOICE_OPENAI_API_KEY === 'string' && /^\S+$/.test(env.BOR_VOICE_OPENAI_API_KEY);
}

async function authorized(request, secret) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(secret ?? '')) return false;
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('Authorization') ?? '');
  if (!match) return false;
  const encoder = new TextEncoder();
  const algorithm = { name: 'HMAC', hash: 'SHA-256' };
  const message = encoder.encode('BOR AI voice pilot');
  const [expected, supplied] = await Promise.all([secret, match[1]].map(value =>
    crypto.subtle.importKey('raw', encoder.encode(value), algorithm, false, ['sign', 'verify'])));
  const tag = await crypto.subtle.sign('HMAC', expected, message);
  return crypto.subtle.verify('HMAC', supplied, tag, message);
}

async function readOffer(request) {
  if (request.headers.get('Content-Type') !== 'application/sdp') return { status: 415 };
  if (!request.body || Number(request.headers.get('Content-Length')) > maxSdpBytes) return { status: 413 };

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let sdp = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxSdpBytes) {
        await reader.cancel();
        return { status: 413 };
      }
      sdp += decoder.decode(value, { stream: true });
    }
    sdp += decoder.decode();
  } catch {
    await reader.cancel().catch(() => {});
    return { status: 400 };
  } finally {
    reader.releaseLock();
  }
  return /^v=0\r?\n/.test(sdp) ? { sdp } : { status: 400 };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== pilotPath) return json({ error: 'not_found' }, 404);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
    if (!await authorized(request, env.BOR_VOICE_OPERATOR_TOKEN)) return json({ error: 'unauthorized' }, 401);
    if (!budgetVerified(env) || !env.VOICE_PILOT) return json({ error: 'paid_voice_disabled' }, 503);

    const offer = await readOffer(request);
    if (!offer.sdp) return json({ error: 'invalid_offer' }, offer.status);
    const pilot = env.VOICE_PILOT.getByName('bor-ai-voice-pilot');
    try {
      return await pilot.fetch('https://voice-pilot.internal/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      });
    } catch {
      return json({ error: 'voice_unavailable' }, 503);
    }
  },
};

export class VoicePilot {
  #channel;

  constructor(ctx, env, provider = null) {
    this.ctx = ctx;
    this.env = env;
    this.storage = ctx.storage;
    this.provider = provider;
  }

  live() {
    return this.provider ?? createOpenAILive({ apiKey: this.env.BOR_VOICE_OPENAI_API_KEY });
  }

  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/session') {
      return json({ error: 'not_found' }, 404);
    }
    if (!budgetVerified(this.env)) return json({ error: 'paid_voice_disabled' }, 503);
    const { sdp, status } = await readOffer(request);
    if (!sdp) return json({ error: 'invalid_offer' }, status);

    // The storage read gates concurrent requests. The writes are issued together
    // and must both succeed before the provider receives a create request.
    if (await this.storage.get('attempt')) return json({ error: 'pilot_budget_reserved' }, 409);
    const deadline = Date.now() + pilotDurationSeconds(this.env) * 1000;
    await Promise.all([
      this.storage.put('attempt', { deadline, reservedMicrousd: budgetMicrousd, closeRequests: 0 }),
      this.storage.setAlarm(deadline),
    ]);

    try {
      const result = await this.live().create(sdp);
      const id = result?.session?.id;
      if (!validLiveId(id)) throw new Error('voice_identity_unconfirmed');
      const attempt = await this.storage.get('attempt');
      await this.storage.put('attempt', { ...attempt, id });
      await this.#observe(id);

      const answerSdp = result.transport?.sdp;
      const current = await this.storage.get('attempt');
      if (current.finalMicrousd !== undefined || Date.now() >= current.deadline || result.transport?.type !== 'webrtc' ||
          typeof answerSdp !== 'string' || answerSdp.length > maxSdpBytes || !/^v=0\r?\n/.test(answerSdp)) {
        throw new Error('voice_answer_unavailable');
      }
      return json({ answerSdp });
    } catch {
      // An ambiguous create consumes the reservation. A known session is closed by the alarm.
      await this.storage.setAlarm(Date.now());
      return json({ error: 'voice_unavailable' }, 502);
    }
  }

  async #observe(id) {
    if (this.#channel) return this.#channel;
    const channel = await this.live().attach(id);
    this.#channel = channel;
    this.ctx.waitUntil(channel.final.then(async event => {
      if (this.#channel === channel) this.#channel = undefined;
      if (!event) return;

      const attempt = await this.storage.get('attempt');
      if (attempt?.id !== id || attempt.finalMicrousd !== undefined) return;
      const finalMicrousd = Math.ceil(event.usage.seconds * 50_000 / 60);
      await Promise.all([
        this.storage.put('attempt', { ...attempt, finalMicrousd }),
        this.storage.deleteAlarm(),
      ]);
      channel.disconnect();
    }).catch(() => {
      // The persisted reservation stays locked if final usage cannot be saved.
      channel.disconnect();
    }));
    return channel;
  }

  async alarm() {
    const attempt = await this.storage.get('attempt');
    if (!attempt?.id || attempt.finalMicrousd !== undefined || attempt.closeRequests >= maxCloseRequests) return;
    const next = { ...attempt, closeRequests: attempt.closeRequests + 1 };
    const save = this.storage.put('attempt', next);
    if (next.closeRequests < maxCloseRequests) {
      await Promise.all([save, this.storage.setAlarm(Date.now() + retryDelayMs)]);
    } else {
      await save;
    }

    await closeExistingSession({
      sessionId: attempt.id,
      observe: id => this.#observe(id),
      disconnect: () => {
        const channel = this.#channel;
        this.#channel = undefined;
        channel?.disconnect();
      },
      hangup: id => this.live().hangup(id),
    });
  }
}
