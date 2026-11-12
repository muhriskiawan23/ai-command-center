import { safeError } from "./safe-error.js";
import { json, sha256Hex } from "./http.js";

// ---- Daily usage limits (cost protection) -------------------------------------------------------------
// Units per UTC day. A normal message costs 1; a multi-agent request (several model calls) costs MULTI_AGENT_UNITS.
// Defaults can be overridden with the env vars DAILY_LIMIT_GUEST / DAILY_LIMIT_USER / DAILY_LIMIT_GLOBAL.
export const DAILY_LIMIT_DEFAULTS = { guest: 15, user: 150, global: 1500 };
export const MULTI_AGENT_UNITS = 3;

export function dailyLimit(env, scope) {
  const configured = Number(env[`DAILY_LIMIT_${scope.toUpperCase()}`]);
  return Number.isInteger(configured) && configured > 0 ? configured : DAILY_LIMIT_DEFAULTS[scope];
}
export function usageDay(now = new Date()) { return now.toISOString().slice(0, 10); }
export function secondsUntilNextUtcDay(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

// Atomic check-and-consume: the counter only moves if it stays within the limit. Returns the new total, or null if refused.
export async function consumeUsage(env, day, subject, units, limit) {
  if (units > limit) return null;
  const row = await env.DB.prepare(
    "INSERT INTO daily_usage (day, subject, units, updated_at) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(day, subject) DO UPDATE SET units = daily_usage.units + excluded.units, updated_at = excluded.updated_at " +
    "WHERE daily_usage.units + excluded.units <= ? RETURNING units"
  ).bind(day, subject, units, Math.floor(Date.now() / 1000), limit).first();
  return row ? Number(row.units) : null;
}
export async function refundUsage(env, day, charges) {
  for (const charge of charges) {
    try {
      await env.DB.prepare("UPDATE daily_usage SET units = MAX(units - ?, 0) WHERE day = ? AND subject = ?").bind(charge.units, day, charge.subject).run();
    } catch (error) { console.error("Usage refund failed:", safeError(error)); }
  }
}

export function limitResponse(scope, limit) {
  const reset = "Reset otomatis pukul 07.00 WIB.";
  const message = scope === "guest"
    ? `Batas harian tamu tercapai (${limit} pesan). Masuk dengan Google untuk batas lebih besar, atau coba lagi besok. ${reset}`
    : scope === "user"
      ? `Batas harian akun tercapai (${limit} pesan). ${reset}`
      : "Layanan sedang mencapai batas pemakaian harian. Silakan coba lagi besok.";
  return json({ error: message, code: "daily_limit", scope }, 429, { "Retry-After": String(secondsUntilNextUtcDay()) });
}

// Returns { ok:true, day, charges } or { ok:false, response }. Without a DB binding limits are skipped (local/dev).
export async function enforceDailyLimits(env, request, user, units) {
  if (!env.DB) return { ok: true, day: null, charges: [] };
  const day = usageDay();
  // Keep successful partial charges visible to every error path so they can be refunded.
  const charges = [];
  try {
    const scope = user ? "user" : "guest";
    const subject = user
      ? `user:${user.id}`
      : "guest:" + (await sha256Hex(`${day}|${request.headers.get("CF-Connecting-IP") || "unknown-client"}|${env.USAGE_SALT || ""}`)).slice(0, 32);
    const subjectLimit = dailyLimit(env, scope);
    if (await consumeUsage(env, day, subject, units, subjectLimit) === null) return { ok: false, response: limitResponse(scope, subjectLimit) };
    charges.push({ subject, units });
    const globalLimit = dailyLimit(env, "global");
    const globalTotal = await consumeUsage(env, day, "global", units, globalLimit);
    if (globalTotal === null) {
      await refundUsage(env, day, charges);
      return { ok: false, response: limitResponse("global", globalLimit) };
    }
    charges.push({ subject: "global", units });
    // First consumption of the day: drop counters older than two days so the table stays small.
    if (globalTotal === units) {
      try { await env.DB.prepare("DELETE FROM daily_usage WHERE day < ?").bind(usageDay(new Date(Date.now() - 2 * 86400000))).run(); }
      catch (error) { console.error("Usage cleanup failed:", safeError(error)); }
    }
    return { ok: true, day, charges };
  } catch (error) {
    await refundUsage(env, day, charges);
    if (/no such table/i.test(String(error?.message))) {
      // Fail closed: a missing quota table must never silently disable cost controls.
      console.error("Daily usage limits unavailable; verify and apply D1 migrations before serving chat traffic.");
      return { ok: false, response: json({ error: "Layanan pembatasan pemakaian belum siap. Silakan coba lagi nanti." }, 503) };
    }
    console.error("Daily usage check failed:", safeError(error));
    return { ok: false, response: json({ error: "Layanan pembatasan pemakaian sedang bermasalah. Coba lagi nanti." }, 503) };
  }
}
