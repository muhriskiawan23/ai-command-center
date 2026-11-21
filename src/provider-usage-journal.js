// INACTIVE Stage 3: auditable per-attempt provider cost events, NOT production
// billing, invoicing, payment authorization, or an approved provider tariff.
// The caller must supply opaque SERVER-ISSUED IDs and a SERVER-APPROVED tariff.
// No raw prompts, completions, identity, response bodies or user PII are stored.
import { calculateProviderCostMicroUsd } from "./credit-metering.js";

const MAX=BigInt(Number.MAX_SAFE_INTEGER);
const KINDS=new Set(["dispatched","usage_measured","outcome_unknown","usage_unverified"]);
function checked(value,pattern,name) {
  if(typeof value!=="string" || !pattern.test(value))
    throw new TypeError(name+" must be a bounded opaque identifier");
  return value;
}
const opaque=(value,name)=>checked(value,/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/,name);
const providerId=(value)=>checked(value,/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/,"provider");
const modelId=(value)=>checked(value,/^[A-Za-z0-9@][A-Za-z0-9@/._:-]{0,179}$/,"model");
const versionId=(value)=>checked(value,/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/,"rateVersion");
function dbOf(env) {
  if(!env?.DB?.prepare || typeof env.DB.prepare!=="function")
    throw new TypeError("D1 database binding required");
  return env.DB;
}
function micro(value,label) {
  if(typeof value!=="bigint" || value<0n || value>MAX)
    throw new TypeError(label+" must be a safe non-negative bigint");
  return value;
}
// Require a complete, non-conflicting counter pair; partial or inconsistent
// aliases are NEVER silently interpreted as a free API invocation.
export function strictProviderTokenUsage(usage) {
  if(!usage || typeof usage!=="object" || Array.isArray(usage)) return null;
  const pairs=[["prompt_tokens","completion_tokens"],["input_tokens","output_tokens"]];
  let measured=null;
  for(const [i,o] of pairs) {
    const hasInput=Object.hasOwn(usage,i),hasOutput=Object.hasOwn(usage,o);
    if(!hasInput && !hasOutput) continue;
    if(!hasInput || !hasOutput ||
       !Number.isSafeInteger(usage[i]) || usage[i]<0 ||
       !Number.isSafeInteger(usage[o]) || usage[o]<0)
      return null;
    if(usage[i]===0 && usage[o]===0) return null;
    if(measured && (measured.inputTokens!==usage[i] || measured.outputTokens!==usage[o]))
      return null;
    measured={inputTokens:usage[i],outputTokens:usage[o]};
  }
  return measured;
}

// A single atomic INSERT confirms the recorded event. A failed write returns
// ok:false so the eventual inference call-site can fail closed. It must write
// 'dispatched' BEFORE invoking any paid provider. A later 'usage_measured'
// may resolve earlier unknown/unverified events, but never rewrite history.
export async function appendProviderUsageEvent(env,{
  attemptId,requestId,provider,model,rateVersion,kind,usage,tariff,nowMs=Date.now()
}) {
  const db=dbOf(env);
  opaque(attemptId,"attemptId");opaque(requestId,"requestId");
  providerId(provider);modelId(model);versionId(rateVersion);
  if(!KINDS.has(kind)) throw new TypeError("Recognized journal event kind required");
  if(!Number.isSafeInteger(nowMs) || nowMs<0)
    throw new TypeError("Valid non-negative timestamp required");
  let input=null,output=null,cost=null;
  if(kind==="usage_measured") {
    if(!tariff || tariff.approved!==true ||
      tariff.version!==rateVersion || tariff.provider!==provider ||
      tariff.model!==model)
      throw new TypeError("Server-approved matching tariff required");
    const parsed=strictProviderTokenUsage(usage);
    if(!parsed) return {ok:false,reason:"authoritative_usage_unverified"};
    input=parsed.inputTokens;output=parsed.outputTokens;
    const inRate=micro(tariff.inputRateMicroUsdPerMillion,"input rate");
    const outRate=micro(tariff.outputRateMicroUsdPerMillion,"output rate");
    if(inRate===0n || outRate===0n)
      throw new TypeError("Nonzero measured rate required");
    const calculated=calculateProviderCostMicroUsd({
      inputTokens:input,outputTokens:output,
      inputRateMicroUsdPerMillion:inRate,
      outputRateMicroUsdPerMillion:outRate
    });
    if(calculated>MAX) return {ok:false,reason:"measured_cost_overflow"};
    cost=Number(calculated);
  } else if(usage!==undefined || tariff!==undefined) {
    throw new TypeError("Only measured events may carry token usage and tariff");
  }
  const created=Math.floor(nowMs/1000);
  try {
    const row=await db.prepare(
      "INSERT INTO provider_usage_events "+
      "(attempt_id,event_kind,request_id,provider,model,rate_version,"+
      "input_tokens,output_tokens,provider_cost_micro_usd,created_at) "+
      "VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING attempt_id,event_kind"
    ).bind(attemptId,kind,requestId,provider,model,rateVersion,
      input,output,cost,created).first();
    return row?.attempt_id===attemptId && row?.event_kind===kind
      ? {ok:true,eventKind:kind}
      : {ok:false,reason:"journal_insert_unconfirmed"};
  } catch {
    return {ok:false,reason:"journal_insert_rejected"};
  }
}

// Read-only aggregate evidence. This is NOT provider invoice reconciliation.
// A previously unknown provider outcome stays unresolved unless the same
// attempt later has a verified usage_measured entry.
export async function inspectProviderUsageJournal(env) {
  const db=dbOf(env);
  const row=await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='dispatched') AS dispatched,
      (SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='usage_measured') AS measured,
      (SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='outcome_unknown') AS unknown_events,
      (SELECT COUNT(*) FROM provider_usage_events WHERE event_kind='usage_unverified') AS unverified_events,
      (SELECT COALESCE(SUM(provider_cost_micro_usd),0)
        FROM provider_usage_events WHERE event_kind='usage_measured') AS measured_micro_usd,
      (SELECT COUNT(*) FROM provider_usage_events d
        WHERE d.event_kind='dispatched'
          AND NOT EXISTS(
            SELECT 1 FROM provider_usage_events m
            WHERE m.attempt_id=d.attempt_id AND m.event_kind='usage_measured'
          )) AS unresolved_attempts
  `).first();
  const fields=["dispatched","measured","unknown_events",
    "unverified_events","measured_micro_usd","unresolved_attempts"];
  if(!row || fields.some(k=>!Number.isSafeInteger(row[k]) || row[k]<0))
    throw new Error("Provider usage journal audit unavailable; refuse clean verdict");
  return {
    scope:"inactive_provider_usage_journal_only",
    dispatchedAttempts:row.dispatched,
    measuredAttempts:row.measured,
    unknownEvents:row.unknown_events,
    usageUnverifiedEvents:row.unverified_events,
    measuredCostMicroUsd:row.measured_micro_usd,
    unresolvedAttempts:row.unresolved_attempts,
    reviewRequired:row.unresolved_attempts>0,
    providerInvoiceVerified:false
  };
}
