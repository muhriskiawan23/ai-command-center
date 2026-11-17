// INACTIVE Stage 3: privacy-minimizing per-request triage of ORIGINAL holds.
// A diagnostic, not an authorization engine, endpoint, or billing mutation.
// Call only behind independently reviewed operator authentication. Do not
// expose raw request/account IDs, prompts, source invoices or tokens.
// Always require separate authenticated provider evidence and human approval.
const MAX_ID=120;
const SQL=`
WITH journal AS (
 SELECT
   COUNT(CASE WHEN event_kind='dispatched' THEN 1 END) AS dispatched,
   COUNT(CASE WHEN event_kind='usage_measured' THEN 1 END) AS measured,
   COALESCE(SUM(CASE WHEN event_kind='usage_measured' THEN provider_cost_micro_usd ELSE 0 END),0) AS measured_cost,
   COUNT(DISTINCT CASE WHEN event_kind='dispatched' THEN rate_version END) AS rate_versions,
   COUNT(CASE WHEN event_kind='dispatched' AND NOT EXISTS (
       SELECT 1 FROM provider_usage_events terminal
       WHERE terminal.attempt_id=events.attempt_id AND terminal.event_kind='usage_measured'
   ) THEN 1 END) AS unmeasured,
   COUNT(CASE WHEN event_kind IN ('usage_unverified','outcome_unknown') AND NOT EXISTS (
       SELECT 1 FROM provider_usage_events terminal
       WHERE terminal.attempt_id=events.attempt_id AND terminal.event_kind='usage_measured'
   ) THEN 1 END) AS unresolved
 FROM provider_usage_events events WHERE events.request_id=?
)
SELECT
 c.status AS wallet_status, c.reserved_microcredits AS wallet_reserved,
 c.settled_microcredits AS wallet_settled,
 b.status AS provider_status, b.reserved_micro_usd AS provider_reserved,
 b.actual_micro_usd AS provider_actual,
 j.dispatched, j.measured, j.measured_cost, j.rate_versions, j.unmeasured, j.unresolved,
 (SELECT COUNT(*) FROM provider_usage_events d
   WHERE d.request_id=q.request_id AND d.event_kind='dispatched'
   AND (b.id IS NULL OR d.provider!=b.provider OR d.model!=b.model))
   AS mismatched_dispatch_identity,
 (SELECT COUNT(*) FROM credit_ledger l
   WHERE l.reference_id=q.request_id AND c.user_id=l.user_id
   AND l.reason='refund') AS refund_events
FROM (SELECT ? AS request_id) q
LEFT JOIN credit_reservations c ON c.request_id=q.request_id
LEFT JOIN provider_budget_reservations b ON b.id='ai:' || q.request_id
CROSS JOIN journal j
`;

const COUNTS=["dispatched","measured","measured_cost","rate_versions","unmeasured","unresolved","mismatched_dispatch_identity","refund_events"];
const OPTIONAL_AMOUNTS=["wallet_reserved","wallet_settled","provider_reserved","provider_actual"];

function nonnegativeSafe(x){return Number.isSafeInteger(x)&&x>=0;}
function readStatus(status,allowed) {
  return status===null || allowed.includes(status);
}
function failClosed(reason) {
  return Object.freeze({
    reviewClass:"escalate", reasons:Object.freeze([reason]),
    providerInvoiceVerified:false, operatorActionAuthorized:false,
    scope:"inactive_stage3_read_only_case_triage"
  });
}

// This returns ONLY metadata and aggregate counts for an authorized caller.
// No raw account IDs, request IDs, attempt IDs or PII leave this function.
// 'candidate' means a human may investigate a proposed path, NOT permission
// to call finalizeCredits or settleProviderSpend.
export async function inspectStage3RecoveryCase(env,{requestId}={}) {
  if(!env?.DB?.prepare||typeof env.DB.prepare!=="function")
    throw new TypeError("D1 binding required for Stage 3 operator case triage");
  if(typeof requestId!=="string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/.test(requestId) ||
     requestId.length>MAX_ID)
    throw new TypeError("Bounded server-issued request ID required");
  const row=await env.DB.prepare(SQL).bind(requestId,requestId).first();
  if(!row || COUNTS.some(key=>!nonnegativeSafe(row[key])) ||
      OPTIONAL_AMOUNTS.some(key=>row[key]!==null && !nonnegativeSafe(row[key])) ||
      !readStatus(row.wallet_status,["reserved","settled","released"]) ||
      !readStatus(row.provider_status,["reserved","settled"]))
    throw new Error("Incomplete or invalid Stage 3 case snapshot");

  const problems=[];
  if(row.wallet_status===null) problems.push("wallet_record_missing");
  if(row.provider_status===null) problems.push("provider_budget_record_missing");
  if(row.dispatched && (!row.wallet_status||!row.provider_status)) problems.push("orphan_dispatch");
  if(row.mismatched_dispatch_identity) problems.push("dispatched_provider_or_model_mismatch");
  if(row.rate_versions>1) problems.push("mixed_tariff_versions");
  if(row.unmeasured>0 || row.unresolved>0) problems.push("unverified_provider_attempt");
  if(row.dispatched>1) problems.push("multi_attempt_invoice_review");
  if(row.measured>row.dispatched) problems.push("metering_without_dispatch");
  if(row.dispatched>0 && row.measured===0) problems.push("no_authoritative_measured_usage");
  if(row.provider_status==="settled" && row.provider_actual===0 && row.dispatched>0)
    problems.push("zero_provider_cost_after_dispatch");
  if(row.provider_status==="settled" && row.measured>0 &&
     row.measured_cost!==row.provider_actual)
    problems.push("provider_measured_cost_mismatch");
  if(row.provider_status==="settled" && row.provider_actual>0 && !row.measured)
    problems.push("provider_charge_without_measured_usage");
  if(row.wallet_status==="released" && row.dispatched>0)
    problems.push("customer_credit_released_after_dispatch");
  if(row.wallet_status==="settled" && !row.measured)
    problems.push("customer_credit_settled_without_measured_usage");
  if(row.wallet_status==="settled" && row.provider_status!=="settled")
    problems.push("customer_credit_settled_without_provider");
  if(row.wallet_status==="released" && row.provider_status==="reserved")
    problems.push("customer_credit_released_while_provider_reserved");
  if(row.wallet_status==="released" && row.provider_actual>0)
    problems.push("customer_credit_released_with_provider_cost");
  if(row.wallet_status==="reserved" && row.refund_events>0)
    problems.push("refund_exists_for_reserved_wallet");
  if(row.wallet_status==="settled" && row.wallet_settled===0 && row.measured)
    problems.push("zero_customer_charge_after_metering");

  if(problems.length)
    return Object.freeze({
      reviewClass:"escalate",reasons:Object.freeze([...new Set(problems)]),
      dispatchedAttempts:row.dispatched,measuredAttempts:row.measured,
      unresolvedAttempts:row.unmeasured,
      providerInvoiceVerified:false,operatorActionAuthorized:false,
      scope:"inactive_stage3_read_only_case_triage"
    });

  let reviewClass="no_financial_recovery";
  if(row.wallet_status==="reserved" && row.provider_status==="settled" && row.measured>0)
    reviewClass="candidate_wallet_finalization_review";
  else if(row.wallet_status==="reserved" && row.provider_status==="reserved" && row.measured===1)
    reviewClass="candidate_provider_then_wallet_review";
  else if(row.wallet_status==="reserved" && row.provider_status==="reserved" && row.dispatched===0)
    reviewClass="candidate_verified_no_dispatch_review";
  else if(row.wallet_status==="reserved" && row.provider_status==="settled" &&
          row.provider_actual===0 && row.dispatched===0)
    reviewClass="candidate_verified_no_dispatch_review";
  else if(row.wallet_status==="reserved" && row.provider_status==="reserved" && row.dispatched>0)
    return failClosed("unknown_provider_outcome");

  return Object.freeze({
    reviewClass,reasons:Object.freeze([]),
    dispatchedAttempts:row.dispatched,measuredAttempts:row.measured,
    unresolvedAttempts:row.unmeasured,
    providerInvoiceVerified:false,operatorActionAuthorized:false,
    scope:"inactive_stage3_read_only_case_triage"
  });
}
