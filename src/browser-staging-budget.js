// Staging-only, operator-only admission. This D1 database must never be
// bor-ai-chat, billing shadow, or any production payments/credit database.
export const STAGING_BROWSER_MAX_RESERVATION_SECONDS = 30;
export const STAGING_BROWSER_MAX_DAILY_SECONDS = 120;
export const STAGING_BROWSER_LEASE_MS = 40_000;

const QUOTA_SQL = [
  "INSERT INTO browser_staging_usage(day, reserved_seconds)",
  "SELECT ?, ? WHERE ? <= ?",
  "ON CONFLICT(day) DO UPDATE SET",
  "reserved_seconds = browser_staging_usage.reserved_seconds + excluded.reserved_seconds",
  "WHERE browser_staging_usage.reserved_seconds + excluded.reserved_seconds <= ?",
  "RETURNING reserved_seconds"
].join(" ");
const LEASE_SQL = [
  "INSERT INTO browser_staging_lease(slot, owner_token, expires_ms)",
  "VALUES(1, ?, ?)",
  "ON CONFLICT(slot) DO UPDATE SET",
  "owner_token = excluded.owner_token, expires_ms = excluded.expires_ms",
  "WHERE browser_staging_lease.expires_ms <= ?",
  "RETURNING slot"
].join(" ");
const RELEASE_SQL = "DELETE FROM browser_staging_lease WHERE slot = 1 AND owner_token = ?";

function wholeNumber(raw, max) {
  if ((typeof raw !== "string" && typeof raw !== "number") ||
      !/^[0-9]+$/.test(String(raw).trim())) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= max ? value : 0;
}

export async function reserveStagingBrowserSlot(env, { now = Date.now(), token } = {}) {
  const db = env?.BROWSER_DB;
  const dailyLimit = wholeNumber(env?.STAGING_BROWSER_DAILY_SECONDS_LIMIT, STAGING_BROWSER_MAX_DAILY_SECONDS);
  const seconds = wholeNumber(env?.STAGING_BROWSER_RESERVATION_SECONDS, STAGING_BROWSER_MAX_RESERVATION_SECONDS);
  if (env?.STAGING_BROWSER_ENABLED !== "true" || !dailyLimit || !seconds ||
      seconds > dailyLimit || !db?.prepare || typeof token !== "string" ||
      !/^[0-9a-f-]{36}$/.test(token)) return { ok: false, code: "staging_not_ready" };
  // The single D1 lease serializes staging sessions across Worker isolates.
  // A crashed Worker holds it for at most STAGING_BROWSER_LEASE_MS.
  let leased = false;
  try {
    const row = await db.prepare(LEASE_SQL).bind(token, now + STAGING_BROWSER_LEASE_MS, now).first();
    if (row?.slot !== 1) return { ok: false, code: "browser_busy" };
    leased = true;
    const day = new Date(now).toISOString().slice(0, 10);
    const budget = await db.prepare(QUOTA_SQL).bind(day, seconds, seconds, dailyLimit, dailyLimit).first();
    if (!budget) {
      await releaseStagingBrowserSlot(env, token);
      return { ok: false, code: "browser_daily_quota_exhausted" };
    }
    return { ok: true, reservationSeconds: seconds, remainingSeconds: Math.max(0, dailyLimit - Number(budget.reserved_seconds)), token };
  } catch {
    if (leased) await releaseStagingBrowserSlot(env, token);
    return { ok: false, code: "browser_budget_unavailable" };
  }
}

// Never refund after uncertain browser launch: the provider might have billed.
export async function releaseStagingBrowserSlot(env, token) {
  try {
    if (typeof token !== "string" || !/^[0-9a-f-]{36}$/.test(token) || !env?.BROWSER_DB?.prepare) return false;
    await env.BROWSER_DB.prepare(RELEASE_SQL).bind(token).run();
    return true;
  } catch {
    return false;
  }
}
