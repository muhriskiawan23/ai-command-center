// ONLY for wrangler dev --local tests. NEVER deploy this fixture.
import {drill, PURPOSE} from '../../src/chat-journal-staging-d1-recovery-drill.js';
export {ChatJournalDurableObject} from '../../src/chat-journal-do.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (env.RECOVERY_LOCAL_ONLY !== 'true' ||
        url.hostname !== '127.0.0.1' ||
        url.pathname !== '/__synthetic_recovery_do_d1' ||
        request.method !== 'POST') {
      return new Response('Not found', {status:404});
    }
    let payload;
    try { payload = await request.json(); } catch {
      return Response.json({ok:false}, {status:400});
    }
    if (Object.keys(payload || {}).length !== 1 || payload?.purpose !== PURPOSE) {
      return Response.json({ok:false}, {status:403});
    }
    try {
      const result = await drill(env, {payload, runId:env.RECOVERY_RUN_ID});
      return Response.json({ok:true, result});
    } catch (err) {
      console.error('synthetic local recovery failed:', String(err?.message || 'unknown').slice(0,180));
      return Response.json({ok:false}, {status:409});
    }
  }
};
