import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto,randomBytes} from "node:crypto";
import {
  stage3AttestationMessage,createStage3SignedReviewerVerifier
} from "../src/stage3-signed-operator-auth.js";
import {inspectStage3OperatorEvidence} from "../src/stage3-operator-review.js";

const NOW=1_800_000_000_000;
const proposal={
  caseId:"synthetic-only",evidenceSha256:"a".repeat(64),
  providerStatementSha256:"b".repeat(64),actualCostMicroUsd:519,
  disposition:"request_separate_finance_review"
};
async function fixture(){
  const signers=[];
  for(const [principalId,role] of [["review-finance","finance"],["review-security","security"]]){
    const keys=await webcrypto.subtle.generateKey({name:"Ed25519"},true,["sign","verify"]);
    const raw=await webcrypto.subtle.exportKey("raw",keys.publicKey);
    signers.push({
      principalId,role,privateKey:keys.privateKey,
      trust:{principalId,role,keyId:"v1",publicKeyBase64Url:Buffer.from(raw).toString("base64url"),
        validFromMs:NOW-100000,validUntilMs:NOW+500000,active:true}
    });
  }
  const sign=async (signer,p=proposal,patch={})=>{
    const attestation={
      principalId:signer.principalId,keyId:"v1",
      issuedAtMs:NOW-5000,expiresAtMs:NOW+300000,
      nonce:randomBytes(24).toString("base64url"),...patch
    };
    const message=stage3AttestationMessage(p,attestation);
    const sig=await webcrypto.subtle.sign("Ed25519",signer.privateKey,message);
    return {...attestation,signature:Buffer.from(sig).toString("base64url")};
  };
  return {signers,sign,trustedReviewers:signers.map(x=>x.trust)};
}
const check=async(fx,approvals,overrides={})=>inspectStage3OperatorEvidence({
  ...proposal,approvals,
  verifyProviderStatement:async p=>({...p,verified:true}),
  verifyReviewer:createStage3SignedReviewerVerifier({
    trustedReviewers:fx.trustedReviewers,nowMs:NOW,cryptoImpl:webcrypto
  }),
  ...overrides
});
function noFinancialAuthority(report) {
  assert.equal(report.financialActionAuthorized,false);
  assert.equal(report.customerDebitAuthorized,false);
  assert.equal(report.providerInvoiceReconciled,false);
  assert.equal(JSON.stringify(report).includes("review-finance"),false);
  assert.equal(JSON.stringify(report).includes("synthetic-only"),false);
}
test("actual Ed25519 signature checks with different finance/security public keys support evidence review only",async()=>{
  const fx=await fixture();
  const approvals=await Promise.all(fx.signers.map(x=>fx.sign(x)));
  const report=await check(fx,approvals);
  assert.equal(report.independentReviewConfirmed,true);
  noFinancialAuthority(report);
});
test("one signer cannot impersonate a different server-assigned role",async()=>{
  const fx=await fixture();
  const finance=await fx.sign(fx.signers[0]);
  const other={...finance,principalId:"review-security"};
  const r=await check(fx,[finance,other]);
  assert.equal(r.independentReviewConfirmed,false);
  noFinancialAuthority(r);
});
test("revoked public key, unknown key ID and mismatched trust stores fail closed",async()=>{
  const fx=await fixture(),approvals=await Promise.all(fx.signers.map(x=>fx.sign(x)));
  for(const trust of [
    fx.trustedReviewers.map(x=>x.role==="finance"?{...x,active:false}:x),
    fx.trustedReviewers.map(x=>x.role==="security"?{...x,keyId:"changed"}:x),
    fx.trustedReviewers.map(x=>x.role==="finance"?{...x,publicKeyBase64Url:fx.trustedReviewers[1].publicKeyBase64Url}:x)
  ]) {
    const report=await check({...fx,trustedReviewers:trust},approvals);
    assert.equal(report.independentReviewConfirmed,false);
    noFinancialAuthority(report);
  }
});
test("signed evidence cannot be transplanted to another cost, case, hash or disposition",async()=>{
  const fx=await fixture(),approvals=await Promise.all(fx.signers.map(x=>fx.sign(x)));
  for(const change of [
    {actualCostMicroUsd:520},{caseId:"different-case"},
    {evidenceSha256:"f".repeat(64)}, {providerStatementSha256:"e".repeat(64)},
    {disposition:"keep_hold"}
  ]) {
    const result=await check(fx,approvals,change);
    assert.equal(result.independentReviewConfirmed,false);
    noFinancialAuthority(result);
  }
});
test("expired, future, extended-window and key-outside-validity attestations fail",async()=>{
  const fx=await fixture();
  for(const patch of [
    {issuedAtMs:NOW-1_000_000,expiresAtMs:NOW-500_000},
    {issuedAtMs:NOW+61_000,expiresAtMs:NOW+120_000},
    {issuedAtMs:NOW-200_000,expiresAtMs:NOW+900_000},
    {issuedAtMs:NOW-200_000,expiresAtMs:NOW+20_000},
    {issuedAtMs:NOW-1000,expiresAtMs:NOW+600_000}
  ]) {
    const approvals=[
      await fx.sign(fx.signers[0],proposal,patch),
      await fx.sign(fx.signers[1])
    ];
    const report=await check(fx,approvals);
    assert.equal(report.independentReviewConfirmed,false);
    noFinancialAuthority(report);
  }
});
test("tampered, malformed and unsigned attestations are denied, no exception leaks",async()=>{
  const fx=await fixture(),approvals=await Promise.all(fx.signers.map(x=>fx.sign(x)));
  const mutated=[
    {...approvals[0],nonce:"X".repeat(32)},
    {...approvals[0],signature:"A".repeat(86)},
    {...approvals[0],signature:"not-base64"},
    {...approvals[0],keyId:"untrusted"},
    {...approvals[0],principalId:{toString:()=>"review-finance"}}
  ];
  for(const first of mutated) {
    const result=await check(fx,[first,approvals[1]]);
    assert.equal(result.independentReviewConfirmed,false);
    noFinancialAuthority(result);
  }
});
test("duplicate trusted reviewer keys and invalid trust configuration are rejected",async()=>{
  const fx=await fixture();
  assert.throws(()=>createStage3SignedReviewerVerifier({
    trustedReviewers:[fx.trustedReviewers[0],fx.trustedReviewers[0]],nowMs:NOW,cryptoImpl:webcrypto
  }),/Duplicate/);
  assert.throws(()=>createStage3SignedReviewerVerifier({
    trustedReviewers:[fx.trustedReviewers[0]],nowMs:NOW,cryptoImpl:webcrypto
  }),/trust store/);
});
