import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {readFileSync} from "node:fs";
import {webcrypto,randomBytes} from "node:crypto";
import {stage3AttestationMessage} from "../src/stage3-signed-operator-auth.js";
import {recordStage3ReviewedAttestationsOnce} from "../src/stage3-operator-review-once.js";

const NOW=1_800_000_000_000;
const proposal={
  caseId:"fictional-review-case",
  evidenceSha256:"a".repeat(64),providerStatementSha256:"b".repeat(64),
  actualCostMicroUsd:519,disposition:"request_separate_finance_review"
};
async function setup(t){
  const db=new DatabaseSync(":memory:");
  t.after(()=>db.close());
  db.exec(readFileSync(new URL("../migrations/0019_stage3_operator_review_nonces_draft.sql",import.meta.url),"utf8"));
  const env={DB:{
    prepare(sql){return{bind(...values){return{sql,values}}};},
    async batch(operations){
      db.exec("BEGIN IMMEDIATE");
      try{
        const results=operations.map(o=>{
          const r=db.prepare(o.sql).run(...o.values);
          return {success:true,meta:{changes:r.changes}};
        });
        db.exec("COMMIT");
        return results;
      }catch(error){
        db.exec("ROLLBACK");
        throw error;
      }
    }
  }};
  const actors=[];
  for(const [principalId,role] of [["finance-operator","finance"],["security-operator","security"]]){
    const pair=await webcrypto.subtle.generateKey("Ed25519",true,["sign","verify"]);
    const pub=Buffer.from(await webcrypto.subtle.exportKey("raw",pair.publicKey))
      .toString("base64url");
    actors.push({principalId,privateKey:pair.privateKey,
      trust:{principalId,role,keyId:"key-v1",publicKeyBase64Url:pub,
        active:true,validFromMs:NOW-100000,validUntilMs:NOW+600000}});
  }
  const sign=async (actor,p=proposal,patch={})=>{
    const value={
      principalId:actor.principalId,keyId:"key-v1",
      nonce:randomBytes(24).toString("base64url"),
      issuedAtMs:NOW-1000,expiresAtMs:NOW+300000,...patch
    };
    const sig=await webcrypto.subtle.sign("Ed25519",actor.privateKey,
      stage3AttestationMessage(p,value));
    return {...value,signature:Buffer.from(sig).toString("base64url")};
  };
  const signBoth=async()=>Promise.all(actors.map(actor=>sign(actor)));
  const inspect=async(approvals,overrides={})=>recordStage3ReviewedAttestationsOnce({
    env,proposal,approvals,
    trustedReviewers:actors.map(a=>a.trust),nowMs:NOW,cryptoImpl:webcrypto,
    verifyProviderStatement:async p=>({...p,verified:true}),
    ...overrides
  });
  const count=()=>db.prepare("SELECT COUNT(*) AS n FROM stage3_operator_review_nonces").get().n;
  return {db,env,actors,sign,signBoth,inspect,count};
}
const noMoney=r=>{
  assert.equal(r.financialActionAuthorized,false);
  assert.equal(r.customerDebitAuthorized,false);
  assert.equal(r.holdReleaseAuthorized,false);
  assert.ok(!JSON.stringify(r).includes(proposal.caseId));
};
test("two real Ed25519 signatures atomically record two one-time D1 nonce digests",async t=>{
  const x=await setup(t),approvals=await x.signBoth();
  const result=await x.inspect(approvals);
  assert.equal(result.oneTimeRecorded,true);
  assert.equal(result.independentReviewConfirmed,true);
  assert.equal(x.count(),2);
  const rows=x.db.prepare("SELECT * FROM stage3_operator_review_nonces").all();
  for(const row of rows){
    assert.match(row.principal_key_digest,/^[a-f0-9]{64}$/);
    assert.match(row.nonce_digest,/^[a-f0-9]{64}$/);
    assert.match(row.proposal_digest,/^[a-f0-9]{64}$/);
  }
  const serial=JSON.stringify(rows);
  assert.ok(!serial.includes(approvals[0].principalId));
  assert.ok(!serial.includes(approvals[0].nonce));
  assert.ok(!serial.includes(proposal.caseId));
  noMoney(result);
});
test("signed approvals cannot be replayed to record twice across runtime calls",async t=>{
  const x=await setup(t),approvals=await x.signBoth();
  assert.equal((await x.inspect(approvals)).oneTimeRecorded,true);
  const second=await x.inspect(approvals);
  assert.equal(second.oneTimeRecorded,false);
  assert.equal(second.status,"escalation_required");
  assert.equal(x.count(),2);
  noMoney(second);
});
test("second duplicate causes an atomic rollback of first fresh nonce",async t=>{
  const x=await setup(t),original=await x.signBoth();
  assert.equal((await x.inspect(original)).oneTimeRecorded,true);
  const next=await x.sign(x.actors[0]);
  const crossed=await x.inspect([next,original[1]]);
  assert.equal(crossed.oneTimeRecorded,false);
  assert.equal(x.count(),2,"one transaction must not leave half a dual review");
  noMoney(crossed);
});
test("invalid signature, revoked role and false provider source cannot record approvals",async t=>{
  const x=await setup(t),both=await x.signBoth();
  for(const overrides of [
    {approvals:[{...both[0],nonce:"X".repeat(32)},both[1]]},
    {trustedReviewers:x.actors.map((a,i)=>({...a.trust,active:i!==0}))},
    {verifyProviderStatement:async()=>({verified:true})}
  ]){
    const result=await x.inspect(overrides.approvals??both,overrides);
    assert.equal(result.oneTimeRecorded,false);
    assert.equal(x.count(),0);
    noMoney(result);
  }
});
test("absent D1 table fails closed and does not grant financial authority",async t=>{
  const x=await setup(t),both=await x.signBoth();
  x.db.exec("DROP TABLE stage3_operator_review_nonces");
  const result=await x.inspect(both);
  assert.equal(result.oneTimeRecorded,false);
  noMoney(result);
});
test("immutable nonce history refuses update/delete even for synthetic operator",async t=>{
  const x=await setup(t);
  assert.equal((await x.inspect(await x.signBoth())).oneTimeRecorded,true);
  assert.throws(()=>x.db.exec("DELETE FROM stage3_operator_review_nonces"),/append_only/);
  assert.throws(()=>x.db.exec("UPDATE stage3_operator_review_nonces SET consumed_at=0"),/append_only/);
  assert.equal(x.count(),2);
});
