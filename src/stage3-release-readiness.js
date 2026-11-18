// BOR AI Stage 3 internal advisory audit. Pure and read-only; not a
// production release controller. Caller-supplied evidence is UNTRUSTED until
// independently reviewed; even 100% checked never enables financial actions.
const CHECKS=Object.freeze([
  ["localRestart","persistent_workerd_restart_and_replay"],
  ["localRegression","exact_head_unit_and_browser_ci"],
  ["stagingTarget","new_disposable_d1_identity_reviewed"],
  ["hostedMultiInstance","exact_head_hosted_cloudflare_d1_multi_instance_proof"],
  ["hostedEmergencyStop","hosted_emergency_off_and_hold_recovery"],
  ["operatorIdentity","real_restricted_operator_identity_and_key_lifecycle"],
  ["operatorDualControl","signed_distinct_finance_security_review_and_nonce_ledger"],
  ["providerSource","authentic_provider_invoice_and_cost_source_verified"],
  ["invoiceLineage","provider_attempt_or_documented_aggregate_reconciliation"],
  ["merchantLifecycle","approved_midtrans_capture_refund_chargeback_fx_fees"],
  ["independentSecurity","independent_security_privacy_egress_approval"],
  ["independentFinance","independent_finance_tariff_budget_margin_approval"],
  ["recoveryAndRetention","hosted_delivery_recovery_retention_and_rollback"],
  ["founderDecision","explicit_founder_recorded_go_no_go_decision"]
]);
const HASH=/^[a-f0-9]{40}$/;
export function inspectStage3ReleaseReadiness({
  headSha, expectedHeadSha, checked={}
}={}){
  if(typeof headSha!=="string"||!HASH.test(headSha)||
     typeof expectedHeadSha!=="string"||!HASH.test(expectedHeadSha)||
     !checked||typeof checked!=="object"||Array.isArray(checked))
    throw new TypeError("Exact SHA and advisory evidence map required");
  const correctCommit=headSha===expectedHeadSha;
  const gates=CHECKS.map(([key,description])=>({
    key,description,
    passed:correctCommit&&Object.hasOwn(checked,key)&&checked[key]===true
  }));
  const missing=gates.filter(g=>!g.passed).map(g=>g.key);
  return {
    scope:"inactive_stage3_read_only_advisory",
    headMatches:correctCommit,
    state:missing.length?"NO_GO":"INDEPENDENT_RELEASE_REVIEW_REQUIRED",
    missing,
    checkedCount:gates.length-missing.length,
    requiredCount:gates.length,
    gates,
    authenticatedEvidenceVerified:false,
    canDeployProduction:false,
    canEnablePaidProvider:false,
    canChargeCustomers:false,
    canMergeFinancialBranches:false
  };
}
