import { buildOffer, LIVE_MODEL, validLiveId } from './live-offer.mjs';
import {providerHttpError,usageEvidence} from './voice-diagnostics.mjs';

const sessionsUrl = 'https://api.openai.com/v1/live/sessions';

export function createOpenAILive({ apiKey, fetchImpl = fetch }) {
  if (typeof apiKey !== 'string' || !apiKey.trim() || /\s/.test(apiKey)) {
    throw new Error('missing_live_api_key');
  }
  const authorization = 'Bearer ' + apiKey;

  async function create(sdp) {
    const response = await fetchImpl(sessionsUrl, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildOffer(sdp)),
      signal: AbortSignal.timeout(12000),
    });
    if (response.status !== 201) {
      await response.body?.cancel();
      throw providerHttpError('live_create_failed',response,'create');
    }
    const result = await response.json();
    if (!validLiveId(result?.session?.id)) throw new Error('live_identity_unconfirmed');

    // The caller journals this ID before exposing the answer or attempting cleanup.
    return { session: { id: result.session.id }, transport: result.transport };
  }

  async function attach(sessionId) {
    if (!validLiveId(sessionId)) throw new Error('invalid_live_session');
    const response = await fetchImpl(sessionsUrl + '/' + sessionId + '/attach', {
      redirect: 'error',
      headers: { Authorization: authorization, Upgrade: 'websocket' },
      signal: AbortSignal.timeout(5000),
    });
    const socket = response.webSocket;
    if (response.status !== 101 || !socket) {
      await response.body?.cancel();
      throw providerHttpError('live_attach_failed',response,'attach');
    }

    let resolveFinal, latest = null;
    const final = new Promise(resolve => { resolveFinal = resolve; });
    const onDisconnect = () => resolveFinal(null);

    socket.addEventListener('close', onDisconnect, { once: true });
    socket.addEventListener('error', onDisconnect, { once: true });
    socket.addEventListener('message', ({ data }) => {
      if (typeof data !== 'string' || data.length > 262144) return;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        return;
      }
      const next=usageEvidence(latest,event,sessionId);
      if(next!==latest)latest=next;
      if (event?.type !== 'session.closed' || event.session?.id !== sessionId ||
          event.session.model !== LIVE_MODEL || !Number.isFinite(event.usage?.seconds) ||
          event.usage.seconds < 0 || event.usage.seconds > 1e9 || !latest?.terminal || latest.seconds!==event.usage.seconds) return;
      resolveFinal({
        type: event.type,
        session: { id: sessionId, model: LIVE_MODEL },
        usage: { seconds: event.usage.seconds },
      });
    });
    socket.accept();

    return {
      final,
      latestUsage:()=>latest?{...latest}:null,
      requestClose() {
        socket.send(JSON.stringify({ type: 'session.close', event_id: crypto.randomUUID() }));
      },
      disconnect() {
        socket.close();
      },
    };
  }

  return { create, attach };
}
