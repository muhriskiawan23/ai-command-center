import { json } from '../../src/http.js';
import { recoveryStatus } from './legacy-recovery.mjs';
import { LIVE_MODEL } from './live-offer.mjs';
import { createOpenAILive } from './openai-live.mjs';
import { closeExistingSession } from './provider-hangup.mjs';
import { disconnectUsage, observeUsage } from './voice-settlement.mjs';

const pilotPath = '/api/voice/session';
const retryDelayMs = 5_000;
const maxCloseRequests = 3;

function pilotState(attempt) {
  if (!attempt) return 'available';
  if (attempt.finalMicrousd !== undefined) return 'pilot_budget_used';
  if (Date.now() > attempt.deadline + maxCloseRequests * retryDelayMs + 10_000) {
    return 'pilot_session_unconfirmed';
  }
  return 'pilot_session_pending';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const statusOnly = url.pathname === pilotPath + '/status';
    if (!statusOnly && url.pathname !== pilotPath) return json({ error: 'not_found' }, 404);

    const method = statusOnly ? 'GET' : 'POST';
    if (request.method !== method) return json({ error: 'method_not_allowed' }, 405, { Allow: method });
    if (!statusOnly && request.headers.get('Origin') !== url.origin) {
      return json({ error: 'invalid_origin' }, 403);
    }
    if (!env.VOICE_PILOT) return json({ error: 'voice_status_unavailable' }, 503);
    if (!statusOnly) return json({ error: 'voice_access_not_ready' }, 403);

    try {
      const pilot = env.VOICE_PILOT.getByName('bor-ai-voice-pilot');
      return await pilot.fetch('https://voice-pilot.internal/status');
    } catch {
      return json({ error: 'voice_unavailable' }, 503);
    }
  },
};

export class VoicePilot {
  #channel;
  #attaching;

  constructor(ctx, env, provider = null) {
    this.ctx = ctx;
    this.env = env;
    this.storage = ctx.storage;
    this.provider = provider;
  }

  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === 'POST' && path === '/session') {
      return json({ error: 'voice_access_not_ready' }, 403);
    }
    if (request.method !== 'GET' || path !== '/status') {
      return json({ error: 'not_found' }, 404);
    }

    const attempt = await this.storage.get('attempt');
    const recovery = recoveryStatus(attempt);
    return json({
      state: pilotState(attempt),
      ...(attempt?.reconciliation ? { reconciliation: attempt.reconciliation } : {}),
      ...(recovery ? { recovery } : {}),
    }, 200, { 'Cache-Control': 'no-store' });
  }

  async #recordUsage(id, event, terminal) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const attempt = await this.storage.get('attempt');
      if (attempt?.id !== id || attempt.finalMicrousd !== undefined) return;

      const current = attempt.usageEvidence ?? {
        sessionId: id, model: LIVE_MODEL, reservedMicrousd: attempt.reservedMicrousd,
      };
      const next = event ? observeUsage(current, event) : disconnectUsage(current);
      if (!terminal) {
        if (next !== current) await this.storage.put('attempt', { ...attempt, usageEvidence: next });
        return;
      }
      if (!next.final) {
        await this.storage.put('attempt', { ...attempt, usageEvidence: next });
        if (attempt.closeRequests < maxCloseRequests) await this.storage.setAlarm(Date.now());
        return;
      }
      await Promise.all([
        this.storage.put('attempt', {
          ...attempt,
          finalMicrousd: next.final.upperMicrousd,
          finalMicrousdKind: 'voice_conservative_upper',
          usageEvidence: next,
        }),
        this.storage.deleteAlarm(),
      ]);
    });
  }

  async #attach(id) {
    const live = this.provider ?? createOpenAILive({ apiKey: this.env.BOR_VOICE_OPENAI_API_KEY });
    const channel = await live.attach(id, event => {
      this.ctx.waitUntil(this.#recordUsage(id, event, false).catch(() => {}));
    });
    this.#channel = channel;
    this.ctx.waitUntil(channel.final.then(async event => {
      if (this.#channel === channel) this.#channel = undefined;
      await this.#recordUsage(id, event, true);
    }).finally(() => channel.disconnect()).catch(() => {
      // Retain the reservation if evidence cannot be recorded.
    }));
    return channel;
  }

  async #observe(id) {
    if (this.#channel) return this.#channel;
    const attaching = this.#attaching ??= this.#attach(id);
    try {
      return await attaching;
    } finally {
      if (this.#attaching === attaching) this.#attaching = undefined;
    }
  }

  async alarm() {
    const id = await this.ctx.blockConcurrencyWhile(async () => {
      const attempt = await this.storage.get('attempt');
      if (!attempt?.id || attempt.finalMicrousd !== undefined || attempt.closeRequests >= maxCloseRequests) return;
      const next = { ...attempt, closeRequests: attempt.closeRequests + 1 };
      await this.storage.put('attempt', next);
      if (next.closeRequests < maxCloseRequests) {
        await this.storage.setAlarm(Date.now() + retryDelayMs);
      }
      return attempt.id;
    });
    if (!id) return;

    await closeExistingSession({
      sessionId: id,
      observe: sessionId => this.#observe(sessionId),
      disconnect: () => {
        const channel = this.#channel;
        this.#channel = undefined;
        channel?.disconnect();
      },
    });
  }
}
