// INACTIVE Stage 3: atomic one-time signed operator review admission only.
// This is NOT a debit/refund/release/production approval path. It requires
// two trusted signature checks and an independently verified provider source
// before writing two append-only review nonce digests to a dedicated D1 table.
// A missing table or DB ambiguity fails closed. No public HTTP entry point.
import {inspectStage3OperatorEvidence} from "./stage3-operator-review.js";
import {createStage3SignedReviewerVerifier} from "./stage3-signed-operator-auth.js";

const encoder=new TextEncoder();
const safeTime=x=>Number.isSafeInteger(x)&&x>=0;
const deny=(reason)=>({
  scope:"inactive_stage3_atomic_review_only",status:"escalation_required",
  reason,oneTimeRecorded:false,independentReviewConfirmed:false,
  financialActionAuthorized:false,customerDebitAuthorized:false,
  holdReleaseAuthorized:false
});
async function digest(cryptoImpl,input){
  const bytes=await cryptoImpl.subtle.digest("SHA-256",encoder.encode(input));
  return Array.from(new Uint8Array(bytes),
    byte=>byte.toString(16).padStart(2,"0")).join("");
}
export async function recordStage3ReviewedAttestationsOnce({
  env,proposal,approvals,trustedReviewers,verifyProviderStatement,
  nowMs=Date.now(),cryptoImpl=globalThis.crypto
}={}){
  if(!env?.DB?.prepare||typeof env.DB.batch!=="function"||
    !safeTime(nowMs)||!cryptoImpl?.subtle?.digest||
    !proposal||typeof proposal!=="object"||Array.isArray(proposal)||
    !Array.isArray(approvals)||approvals.length!==2||
    typeof verifyProviderStatement!=="function")
    throw new TypeError("Restricted D1, evidence and two verified reviewers required");
  // Snapshot all externally supplied fields before asynchronous checks.
  const frozen=Object.freeze({
    caseId:proposal.caseId,evidenceSha256:proposal.evidenceSha256,
    providerStatementSha256:proposal.providerStatementSha256,
    actualCostMicroUsd:proposal.actualCostMicroUsd,
    disposition:proposal.disposition
  });
  const attestations=approvals.map(value=>
    value&&typeof value==="object"&&!Array.isArray(value)
      ?Object.freeze({...value}):value);
  const verifier=createStage3SignedReviewerVerifier({
    trustedReviewers,nowMs,cryptoImpl
  });
  let report;
  try {
    report=await inspectStage3OperatorEvidence({
      ...frozen,approvals:attestations,
      verifyProviderStatement,
      verifyReviewer:verifier
    });
  }catch{return deny("attestation_or_statement_validation_failed");}
  if(report?.independentReviewConfirmed!==true)
    return deny(report?.reason||"independent_review_unconfirmed");
  const consumedAt=Math.floor(nowMs/1000);
  try {
    const proposalDigest=await digest(cryptoImpl,JSON.stringify([
      "stage3-review-binding-v1",frozen.caseId,frozen.evidenceSha256,
      frozen.providerStatementSha256,frozen.actualCostMicroUsd,
      frozen.disposition
    ]));
    const binds=await Promise.all(attestations.map(async item=>({
      principalDigest:await digest(cryptoImpl,JSON.stringify([
        "stage3-review-principal-v1",item.principalId,item.keyId
      ])),
      nonceDigest:await digest(cryptoImpl,JSON.stringify([
        "stage3-review-nonce-v1",item.principalId,item.keyId,item.nonce
      ]))
    })));
    const statement="INSERT INTO stage3_operator_review_nonces "+
      "(principal_key_digest,nonce_digest,proposal_digest,consumed_at) VALUES (?,?,?,?)";
    // Cloudflare D1 batch is a transactional batch. If either nonce already
    // exists, rollback both. No success is reported on ambiguous results.
    const operations=binds.map(b=>env.DB.prepare(statement).bind(
      b.principalDigest,b.nonceDigest,proposalDigest,consumedAt
    ));
    const rows=await env.DB.batch(operations);
    if(!Array.isArray(rows)||rows.length!==2||
      rows.some(row=>row?.success!==true||row?.meta?.changes!==1))
      return deny("nonce_commit_unconfirmed");
  }catch{return deny("nonce_replay_or_storage_unavailable");}
  return {
    scope:"inactive_stage3_atomic_review_only",
    status:"review_evidence_recorded_for_separate_manual_process",
    oneTimeRecorded:true,independentReviewConfirmed:true,
    providerInvoiceReconciled:false,
    financialActionAuthorized:false,customerDebitAuthorized:false,
    holdReleaseAuthorized:false
  };
}
