import { DurableObject } from 'cloudflare:workers';
import { makeOwnerEvidenceExport } from './primary-evidence.mjs';
import { makePrimaryGateway } from './primary-gateway.mjs';
import { createPrimaryLedger } from './primary-ledger.mjs';
import { assessVoiceExposure } from './voice-exposure.mjs';
import phoneWorker, { VoicePilot } from './phone-worker.mjs';

export { VoicePilot };

export class PrimaryVoiceLedger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ledger = createPrimaryLedger({
      storage: ctx.storage,
      assessExposure: assessVoiceExposure,
    });
  }

  readRows() {
    return this.ledger.readEvidenceRows();
  }
}

function status(body, code = 200) {
  return Response.json(body, { status: code, headers: { 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const ledger = () => env.PRIMARY_VOICE_LEDGER.getByName('voice-isolated-ledger');
    if (pathname === '/api/voice/diagnostics') {
      return makeOwnerEvidenceExport({
        origin: env.VOICE_STAGING_ORIGIN,
        ownerId: env.VOICE_STAGE_OWNER,
        async getSession() {
          const identity = await ctx.access?.getIdentity();
          return identity?.email ? { id: identity.email.toLowerCase() } : null;
        },
        readRows: () => ledger().readRows(),
      })(request);
    }
    if (pathname === '/api/voice/session/primary') {
      const open = makePrimaryGateway({ enabled: false });
      await open(request);
      return status({ error: 'voice_access_not_ready' }, 403);
    }
    if (pathname === '/health') {
      if (request.method !== 'GET') return status({ error: 'method_not_allowed' }, 405);
      try {
        await ledger().readRows();
        return status({ ok: true, primary_ledger: 'ready', paid: false });
      } catch {
        return status({ ok: false, primary_ledger: 'unavailable', paid: false }, 503);
      }
    }
    return phoneWorker.fetch(request, env, ctx);
  },
};
