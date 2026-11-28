import { consumeUsage, usageDay } from "./daily-limits.js";

// One durable reservation per outbound proxy hop, including redirects and
// uncertain attempts. This is a request cap, NOT a provider billing guarantee.
export async function reserveRailwayHop(env, { consume = consumeUsage, day = usageDay() } = {}) {
  const raw = env?.RAILWAY_READER_DAILY_HOP_LIMIT;
  if (env?.URL_READER_ENABLED !== "true" || env?.URL_READER_PROVIDER !== "railway" ||
      !env?.DB?.prepare || typeof raw !== "string" || !/^[1-9][0-9]*$/.test(raw) ||
      !Number.isSafeInteger(Number(raw)) || Number(raw) > 1000) {
    throw Error("railway_budget_not_configured");
  }
  let used;
  try { used = await consume(env, day, "provider:railway-reader:global", 1, Number(raw)); }
  catch { throw Error("railway_budget_unavailable"); }
  if (used === null) {
    const error = Error("railway_daily_hop_cap");
    error.code = "EGRESS_TEMPORARY_UNAVAILABLE";
    throw error;
  }
  if (!Number.isSafeInteger(used) || used < 1 || used > Number(raw)) throw Error("railway_budget_invalid");
  return used;
}
