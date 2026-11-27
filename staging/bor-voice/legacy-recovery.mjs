// One owner-authorized recovery of an expired legacy attempt. Never creates a session.
export function claimLegacyRecovery(attempt, nowMs) {
  if (!attempt || attempt.recoveryV1 || attempt.finalMicrousd !== undefined ||
      !Number.isSafeInteger(attempt.deadline) || !Number.isSafeInteger(nowMs) ||
      nowMs <= attempt.deadline + 25000 || attempt.reconciliation !== 'attach_failed') return null;
  const valid = typeof attempt.id === 'string' && /^live_[A-Za-z0-9_-]{1,128}$/.test(attempt.id);
  return { ...attempt, recoveryV1: { state: valid ? 'in_progress' : 'missing_or_invalid_id', startedMs: nowMs } };
}
export function recoveryFailure(error) {
  const code = error?.upstreamStatus;
  if (Number.isInteger(code) && code >= 400 && code <= 599) return 'attach_http_' + code;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'attach_timeout';
  return 'attach_unconfirmed';
}
export function recoveryStatus(record) {
  const state = record?.recoveryV1?.state;
  return typeof state === 'string' && /^(?:in_progress|missing_or_invalid_id|final_observed|close_unconfirmed|attach_timeout|attach_unconfirmed|attach_http_[45][0-9]{2})$/.test(state) ? state : undefined;
}
