// INACTIVE Stage 3. Signed two-role reviewer ATTESTATIONS only.
// No HTTP endpoint, user login, DB writes, invoice trust or financial authority.
// Trusted keys/roles MUST originate from restricted server-side configuration.
// Re-use of a signed attestation for an executable action is prohibited without
// a separately approved persistent one-time nonce/approval ledger.
const ID=/^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/;
const KEY=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;
const NONCE=/^[A-Za-z0-9_-]{24,96}$/;
const B64SIG=/^[A-Za-z0-9_-]{86}$/;
const B64PUB=/^[A-Za-z0-9_-]{43}$/;
const ROLES=new Set(["finance","security"]);
const MAX_AGE_MS=15*60*1000;
const SKEW_MS=60*1000;
const validTime=x=>Number.isSafeInteger(x)&&x>=0;
function bytes(text,length){
  if(typeof text!=="string") return null;
  try {
    const raw=atob(text.replace(/-/g,"+").replace(/_/g,"/")+"==");
    if(raw.length!==length)return null;
    return Uint8Array.from(raw,character=>character.charCodeAt(0));
  } catch { return null; }
}
const bindingValid=p=>p&&typeof p==="object"&&!Array.isArray(p)&&
  typeof p.caseId==="string"&&ID.test(p.caseId)&&
  typeof p.evidenceSha256==="string"&&/^[a-f0-9]{64}$/.test(p.evidenceSha256)&&
  typeof p.providerStatementSha256==="string"&&/^[a-f0-9]{64}$/.test(p.providerStatementSha256)&&
  Number.isSafeInteger(p.actualCostMicroUsd)&&p.actualCostMicroUsd>=0&&
  ["keep_hold","escalate","request_separate_finance_review"].includes(p.disposition);
export function stage3AttestationMessage(proposal,attestation){
  if(!bindingValid(proposal)||!attestation||
     typeof attestation.principalId!=="string"||!ID.test(attestation.principalId)||
     typeof attestation.keyId!=="string"||!KEY.test(attestation.keyId)||
     typeof attestation.nonce!=="string"||!NONCE.test(attestation.nonce)||
     !validTime(attestation.issuedAtMs)||!validTime(attestation.expiresAtMs))
    throw new TypeError("Invalid bounded Stage 3 attestation binding");
  return new TextEncoder().encode(JSON.stringify([
    "bor-ai-stage3-evidence-attestation-v1",
    proposal.caseId,proposal.evidenceSha256,proposal.providerStatementSha256,
    proposal.actualCostMicroUsd,proposal.disposition,
    attestation.principalId,attestation.keyId,
    attestation.issuedAtMs,attestation.expiresAtMs,attestation.nonce
  ]));
}

// The caller cannot choose the authenticated role or key. Only this preloaded
// trust list assigns roles to distinct principals. Unknown/revoked keys fail
// closed. The output cannot be used to mutate financial state.
export function createStage3SignedReviewerVerifier({
  trustedReviewers, nowMs=Date.now(), cryptoImpl=globalThis.crypto
}={}){
  if(!Array.isArray(trustedReviewers)||trustedReviewers.length<2||
     trustedReviewers.length>32||!validTime(nowMs)||
     !cryptoImpl?.subtle?.verify||!cryptoImpl?.subtle?.importKey)
    throw new TypeError("Independent restricted reviewer trust store required");
  const seen=new Set();
  const trust=new Map();
  for(const entry of trustedReviewers){
    if(!entry||typeof entry!=="object"||Array.isArray(entry)||
       typeof entry.principalId!=="string"||!ID.test(entry.principalId)||
       typeof entry.keyId!=="string"||!KEY.test(entry.keyId)||
       !ROLES.has(entry.role)||typeof entry.publicKeyBase64Url!=="string"||
       !B64PUB.test(entry.publicKeyBase64Url)||
       typeof entry.active!=="boolean"||
       !validTime(entry.validFromMs)||!validTime(entry.validUntilMs)||
       entry.validUntilMs<=entry.validFromMs)
      throw new TypeError("Invalid Stage 3 server-configured reviewer key");
    const index=entry.principalId+":"+entry.keyId;
    if(seen.has(index))throw new TypeError("Duplicate reviewer trust key");
    seen.add(index);
    const raw=bytes(entry.publicKeyBase64Url,32);
    if(!raw)throw new TypeError("Invalid reviewer public key bytes");
    trust.set(index,{...entry,raw});
  }
  return async (attestation,proposal)=>{
    if(!bindingValid(proposal)||!attestation||typeof attestation!=="object"||
       Array.isArray(attestation)||typeof attestation.principalId!=="string"||
       typeof attestation.keyId!=="string"||typeof attestation.nonce!=="string"||
       !NONCE.test(attestation.nonce)||typeof attestation.signature!=="string"||
       !B64SIG.test(attestation.signature)||
       !validTime(attestation.issuedAtMs)||!validTime(attestation.expiresAtMs))
      return null;
    const record=trust.get(attestation.principalId+":"+attestation.keyId);
    if(!record||record.active!==true||attestation.expiresAtMs<=nowMs||
       attestation.issuedAtMs>nowMs+SKEW_MS||
       attestation.issuedAtMs<nowMs-MAX_AGE_MS||
       attestation.expiresAtMs<=attestation.issuedAtMs||
       attestation.expiresAtMs-attestation.issuedAtMs>MAX_AGE_MS||
       attestation.issuedAtMs<record.validFromMs||
       attestation.expiresAtMs>record.validUntilMs)
      return null;
    const signature=bytes(attestation.signature,64);
    if(!signature)return null;
    try {
      const key=await cryptoImpl.subtle.importKey("raw",record.raw,
        {name:"Ed25519"},false,["verify"]);
      const message=stage3AttestationMessage(proposal,attestation);
      const verified=await cryptoImpl.subtle.verify("Ed25519",key,signature,message);
      if(verified!==true)return null;
      return {...proposal,verified:true,principalId:record.principalId,role:record.role};
    }catch {return null;}
  };
}
