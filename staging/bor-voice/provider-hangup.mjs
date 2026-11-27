// WebRTC is closed via its sideband. HTTP hangup is documented only for SIP.
// A sent close command is not proof of final usage.
export async function closeExistingSession({ sessionId, observe, disconnect }) {
  try {
    const channel = await observe(sessionId);
    await channel.requestClose();
    return 'sideband_close_requested';
  } catch {
    try { await disconnect(); } catch { /* Keep the reservation locked. */ }
    return 'unconfirmed';
  }
}
