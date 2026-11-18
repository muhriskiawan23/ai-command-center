// INACTIVE Stage 3. Read-only provider statement vs immutable local journal.
// This function cannot authenticate a real provider invoice on its own.
// A trusted, independently implemented source verifier MUST confirm provenance.
// Aggregate provider statements never justify customer debit/hold release.
const PROVIDER=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const HASH=/^[a-f0-9]{64}$/;
const MAX_PERIOD_SECONDS=31*24*3600;
const FIELDS=[
  "dispatchedAttempts","measuredAttempts","unknownEvents",
  "unverifiedEvents","unmeasuredDispatches","uncertainDispatches",
  "measuredCostMicroUsd"
];
const QUERY=`
 SELECT
  COALESCE(SUM(CASE WHEN e.event_kind='dispatched' THEN 1 ELSE 0 END),0) dispatchedAttempts,
  COALESCE(SUM(CASE WHEN e.event_kind='usage_measured' THEN 1 ELSE 0 END),0) measuredAttempts,
  COALESCE(SUM(CASE WHEN e.event_kind='outcome_unknown' THEN 1 ELSE 0 END),0) unknownEvents,
  COALESCE(SUM(CASE WHEN e.event_kind='usage_unverified' THEN 1 ELSE 0 END),0) unverifiedEvents,
  COALESCE(SUM(CASE WHEN e.event_kind='usage_measured'
    THEN e.provider_cost_micro_usd ELSE 0 END),0) measuredCostMicroUsd,
  COALESCE(SUM(CASE WHEN e.event_kind='dispatched'
    AND NOT EXISTS(SELECT 1 FROM provider_usage_events m
      WHERE m.attempt_id=e.attempt_id AND m.event_kind='usage_measured')
    THEN 1 ELSE 0 END),0) unmeasuredDispatches,
  COALESCE(SUM(CASE WHEN e.event_kind='dispatched'
    AND EXISTS(SELECT 1 FROM provider_usage_events u
      WHERE u.attempt_id=e.attempt_id
        AND u.event_kind IN ('outcome_unknown','usage_unverified'))
    THEN 1 ELSE 0 END),0) uncertainDispatches
 FROM provider_usage_events e
 WHERE e.provider=? AND e.created_at>=? AND e.created_at<?
`;
const sameBinding=(r,s)=>r?.verified===true&&
  r.provider===s.provider&&r.statementSha256===s.statementSha256&&
  r.currency===s.currency&&r.usageScope===s.usageScope&&
  r.periodStartSeconds===s.periodStartSeconds&&
  r.periodEndSeconds===s.periodEndSeconds&&
  r.billedMicroUsd===s.billedMicroUsd;
export async function inspectStage3ProviderStatement(env,{
  statement,verifyStatement
}={}){
  if(!env?.DB?.prepare||typeof env.DB.prepare!=="function"||
     !statement||typeof statement!=="object"||Array.isArray(statement)||
     typeof statement.provider!=="string"||!PROVIDER.test(statement.provider)||
     typeof statement.statementSha256!=="string"||!HASH.test(statement.statementSha256)||
     statement.currency!=="USD"||statement.usageScope!=="aggregate"||
     !Number.isSafeInteger(statement.periodStartSeconds)||
     !Number.isSafeInteger(statement.periodEndSeconds)||
     statement.periodStartSeconds<0||
     statement.periodEndSeconds<=statement.periodStartSeconds||
     statement.periodEndSeconds-statement.periodStartSeconds>MAX_PERIOD_SECONDS||
     !Number.isSafeInteger(statement.billedMicroUsd)||statement.billedMicroUsd<0||
     typeof verifyStatement!=="function")
    throw new TypeError("Valid bounded USD provider statement and source verifier required");
  const binding=Object.freeze({
    provider:statement.provider,statementSha256:statement.statementSha256,
    currency:"USD",usageScope:"aggregate",
    periodStartSeconds:statement.periodStartSeconds,
    periodEndSeconds:statement.periodEndSeconds,
    billedMicroUsd:statement.billedMicroUsd
  });
  // One read-only SQLite snapshot, limited to an explicit UTC billing window.
  // A provider's invoice may have a DIFFERENT billing clock than our journal;
  // even an exact aggregate match is no per-attempt proof.
  const row=await env.DB.prepare(QUERY).bind(
    binding.provider,binding.periodStartSeconds,binding.periodEndSeconds
  ).first();
  if(!row||FIELDS.some(k=>!Number.isSafeInteger(row[k])||row[k]<0))
    throw new Error("Provider journal financial snapshot unavailable");
  let receipt=null;
  try {receipt=await verifyStatement(binding);}catch{receipt=null;}
  const sourceVerified=sameBinding(receipt,binding);
  const unresolved=row.unmeasuredDispatches>0||row.unknownEvents>0||
    row.unverifiedEvents>0||row.uncertainDispatches>0;
  const comparable=row.dispatchedAttempts>0&&row.measuredAttempts>0&&
    row.dispatchedAttempts===row.measuredAttempts&&!unresolved;
  const amountMatches=comparable&&row.measuredCostMicroUsd===binding.billedMicroUsd;
  return {
    scope:"inactive_stage3_internal_aggregate_statement_only",
    dispatchedAttempts:row.dispatchedAttempts,
    measuredAttempts:row.measuredAttempts,
    unknownEvents:row.unknownEvents,
    unverifiedEvents:row.unverifiedEvents,
    unmeasuredDispatches:row.unmeasuredDispatches,
    uncertainDispatches:row.uncertainDispatches,
    statementSourceVerified:sourceVerified,
    aggregateAmountMatches:sourceVerified&&amountMatches,
    statementPeriodComplete:false,
    perAttemptInvoiceReconciled:false,
    providerInvoiceVerified:false,
    financialActionAuthorized:false,
    customerDebitAuthorized:false,
    holdReleaseAuthorized:false,
    reviewRequired:true,
    reason:!sourceVerified?"provider_statement_source_unverified":
      unresolved?"unresolved_provider_cost":
      !comparable?"incomplete_provider_usage_window":
      !amountMatches?"aggregate_cost_mismatch":
      "aggregate_match_not_per_attempt_evidence"
  };
}
