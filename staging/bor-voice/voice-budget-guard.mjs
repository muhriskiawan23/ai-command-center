// Monetary values are integer micro-USD. The configured limit must be a
// provider-enforced maximum, not a client timer or a budget alert.
export function voiceBudgetGuard({ enabled, providerMaxSeconds, legacyState, committedMicrousd, pilotCommittedMicrousd, attempts, userAttemptsToday }) {
  if (enabled !== true) return { ok:false, reason:'disabled' };
  if (!['none','settled'].includes(legacyState)) return { ok:false, reason:'legacy_unconfirmed' };
  if (!Number.isSafeInteger(providerMaxSeconds) || providerMaxSeconds < 1 || providerMaxSeconds > 120) return { ok:false, reason:'provider_cap_unverified' };
  const amounts = [committedMicrousd,pilotCommittedMicrousd,attempts,userAttemptsToday];
  if (amounts.some(n=>!Number.isSafeInteger(n)||n<0) || pilotCommittedMicrousd>committedMicrousd) return { ok:false, reason:'invalid_ledger' };
  if (attempts>=3 || userAttemptsToday>=1 || pilotCommittedMicrousd>200000 || committedMicrousd>400000) return { ok:false, reason:'budget_exhausted' };
  return { ok:true, reserveMicrousd:100000, maximumVoiceMicrousd:Math.ceil(providerMaxSeconds*50000/60) };
}
