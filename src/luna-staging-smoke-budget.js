// Staging-only campaign admission. A reservation is not a provider billing guarantee.
export const STAGING_SEARCH_CAMPAIGN_LIMIT = 500000;
const MAX_WINDOW_MS = 15 * 60 * 1000;

const CLAIM_SQL = `
  WITH prior AS (
    SELECT CASE WHEN json_valid(evidence_json)
      THEN json_extract(evidence_json, '$.chargedMicroUsd') END AS paid
    FROM web_search_v2_live_evaluation WHERE id = ?1 AND status = 'completed'
  ), totals AS (
    SELECT COALESCE(SUM(reserved_micro_usd), 0) AS ledger FROM web_search_v2_usage
  ), spend AS (
    SELECT MAX(paid, ledger) AS spent, ledger FROM prior CROSS JOIN totals
    WHERE typeof(paid) = 'integer' AND paid >= 0 AND typeof(ledger) = 'integer' AND ledger >= 0
  )
  INSERT OR IGNORE INTO web_search_v2_live_evaluation (id, status, evidence_json)
  SELECT ?2, 'running', json_object('baseId', ?1, 'priorMicroUsd', spent,
    'ledgerMicroUsd', ledger, 'reservedMicroUsd', ?3, 'budgetMicroUsd', ?4,
    'budgetCommittedMicroUsd', spent + ?3)
  FROM spend
  WHERE spent + ?3 <= ?4
    AND NOT EXISTS (SELECT 1 FROM web_search_v2_live_evaluation
      WHERE status = 'running' OR id LIKE 'web-v2-smoke-%')
    AND NOT EXISTS (SELECT 1 FROM web_search_v2_live_evaluation
      WHERE CASE WHEN json_valid(evidence_json)
        THEN json_extract(evidence_json, '$.chargedMicroUsd') END > spend.spent)
  RETURNING evidence_json
`;

export async function claimStagingSearchSmoke(env, reservation, now = Date.now()) {
  const baseId = env.BOR_LUNA_SEARCH_SMOKE_BASE_ID;
  const expiry = Number(env.BOR_LUNA_SEARCH_SMOKE_EXPIRES_AT);
  if (env.BOR_WEB_SEARCH_KILL_SWITCH === 'true' || env.BOR_LUNA_STAGING_WEB_SEARCH_ENABLED !== 'true' ||
      env.BOR_LUNA_LIVE_EVAL_ID || env.BOR_LUNA_LIVE_TRIGGER_DIGEST || env.BOR_LUNA_RESUME_ID ||
      !/^web-v2-(?!smoke-)[a-z0-9-]{8,60}$/.test(baseId || '') || !Number.isSafeInteger(expiry) ||
      expiry <= now || expiry > now + MAX_WINDOW_MS || !Number.isSafeInteger(reservation) ||
      reservation <= 0 || reservation > STAGING_SEARCH_CAMPAIGN_LIMIT || !env.DB?.prepare) return null;
  const id = 'web-v2-smoke-' + baseId.slice(7);
  try {
    const row = await env.DB.prepare(CLAIM_SQL).bind(baseId, id, reservation, STAGING_SEARCH_CAMPAIGN_LIMIT).first();
    if (!row) return null;
    const evidence = JSON.parse(row.evidence_json);
    // Account for prior router spend that is not included in the search-only ledger.
    const ledgerLimit = STAGING_SEARCH_CAMPAIGN_LIMIT - Math.max(0, evidence.priorMicroUsd - evidence.ledgerMicroUsd);
    if (!Number.isSafeInteger(ledgerLimit) || ledgerLimit < reservation) return null;
    return { id, ledgerLimit, evidence };
  } catch { return null; }
}

export async function finishStagingSearchSmoke(env, claim, ok, providerStatus) {
  const evidence = { ...claim.evidence, ok: Boolean(ok), providerStatus: Number.isInteger(providerStatus) ? providerStatus : null };
  try {
    // Keep the full reservation and irreversible one-shot marker even after failure or timeout.
    await env.DB.prepare("UPDATE web_search_v2_live_evaluation SET status = ?, evidence_json = ? WHERE id = ? AND status = 'running'")
      .bind(ok ? 'completed' : 'stopped', JSON.stringify(evidence), claim.id).run();
  } catch { /* A retained running marker also fails closed. */ }
}
