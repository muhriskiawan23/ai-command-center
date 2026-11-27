// A close request is not proof of final usage. Never settle a ledger here.
export async function requestProviderHangup({ sessionId, authorization, fetchImpl = fetch }) {
  if (typeof sessionId !== 'string' || !/^live_[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new Error('invalid_live_session');
  const response = await fetchImpl('https://api.openai.com/v1/live/sessions/' + sessionId + '/hangup', {
    method: 'POST',
    headers: { Authorization: authorization },
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  await response.body?.cancel().catch(() => {});
  if (!response.ok) throw new Error('live_hangup_unconfirmed');
  return 'http_hangup_requested';
}

export async function closeExistingSession({ sessionId, observe, disconnect, hangup }) {
  try {
    const channel = await observe(sessionId);
    await channel.requestClose();
    return 'sideband_close_requested';
  } catch {
    try { await disconnect(); } catch { /* Still attempt the independent hangup path. */ }
    try {
      await hangup(sessionId);
      return 'http_hangup_requested';
    } catch {
      return 'unconfirmed';
    }
  }
}
