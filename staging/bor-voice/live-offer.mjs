export const LIVE_MODEL = 'gpt-live-1.1';
export const validLiveId = id=>typeof id==='string' && /^live_[A-Za-z0-9_-]{1,128}$/.test(id);
export function buildOffer(sdp){
  if(typeof sdp!=='string'||sdp.length>65536||!/^v=0\r?\n/.test(sdp))throw Error('invalid_offer');
  return {
    session: {
      model: LIVE_MODEL,
      store: false,
      instructions: 'You are BOR AI Voice. Speak naturally in the user’s language. This pilot is conversation only; do not claim to search or perform external actions.',
      audio: { output: { voice: 'marin' } },
      delegation: { type: 'client' },
      client: {
        data_channel: {
          allowed_client_events: ['session.close'],
          allowed_server_events: [
            { type: 'session.started' },
            { type: 'session.closed' },
            { type: 'session.input_transcript.delta' },
            { type: 'session.output_transcript.delta' },
            { type: 'error' },
          ],
        },
      },
    },
    transport: { type: 'webrtc', sdp },
  };
}
