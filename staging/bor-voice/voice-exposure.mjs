// Server-only preflight. Provider limit and legacy evidence must come from trusted
// operator configuration / provider records, never from a browser request.
// All amounts are integer micro-USD. No provider requests are made here.
export function assessVoiceExposure({ providerMaxSeconds, legacy, ledger, reserveMicrousd = 100000, poolMicrousd = 300000 } = {}) {
  const amount = n => Number.isSafeInteger(n) && n >= 0;
  const deny = reason => ({ allowed: false, reason });
  if (!amount(reserveMicrousd) || !reserveMicrousd || !amount(poolMicrousd)) return deny('invalid_budget');
  if (!Number.isSafeInteger(providerMaxSeconds) || providerMaxSeconds <= 0 || providerMaxSeconds > 1000000) return deny('provider_limit_unverified');
  // Conservatively bill every second at active rate, with at least 15s initialization.
  const worstCase = Math.ceil(Math.max(15, providerMaxSeconds) * 50000 / 60);
  if (worstCase > reserveMicrousd) return deny('provider_exposure_exceeds_reserve');
  if (!legacy || legacy.state !== 'confirmed_closed' || !amount(legacy.upperMicrousd)) return deny('legacy_unconfirmed');
  if (!Array.isArray(ledger) || ledger.some(r => !r || r.state !== 'closed' || !amount(r.reservedMicrousd) || !amount(r.actualMicrousd) || r.actualMicrousd > r.reservedMicrousd)) return deny('ledger_unconfirmed_or_overrun');
  // Keep full reservations charged against the pilot pool; no refund or reset here.
  let committed = legacy.upperMicrousd;
  for (const r of ledger) { committed += r.reservedMicrousd; if (!amount(committed)) return deny('invalid_budget'); }
  if (committed > poolMicrousd - reserveMicrousd) return deny('global_limit');
  return { allowed: true, worstCaseMicrousd: worstCase, remainingAfterReserveMicrousd: poolMicrousd - committed - reserveMicrousd };
}
