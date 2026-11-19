import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { midtransSignature, verifyMidtransNotificationSignature } from "../src/midtrans-signature.js";
const payload={order_id:"bor-test-001",status_code:"200",gross_amount:"36254.00"};
const key="sandbox-test-secret-not-real";
test("Midtrans SHA512 formula matches independent Node implementation", async()=>{
  const expected=createHash("sha512").update(payload.order_id+payload.status_code+payload.gross_amount+key).digest("hex");
  assert.equal(await midtransSignature(payload,key),expected);
  assert.equal(await verifyMidtransNotificationSignature({...payload,signature_key:expected},key),true);
});
test("reject tampered order, status, amount, signature and wrong secret",async()=>{
  const signature_key=await midtransSignature(payload,key);
  for(const patch of [{order_id:"other"},{status_code:"201"},{gross_amount:"36255.00"},{signature_key:"0".repeat(128)}])
    assert.equal(await verifyMidtransNotificationSignature({...payload,signature_key,...patch},key),false);
  assert.equal(await verifyMidtransNotificationSignature({...payload,signature_key},"other-key"),false);
  assert.equal(await verifyMidtransNotificationSignature({...payload,signature_key:"garbage"},key),false);
});
test("reject missing and non-string signed fields",async()=>{
  for(const patch of [{order_id:1},{status_code:null},{gross_amount:36254},{order_id:""}])
    await assert.rejects(()=>verifyMidtransNotificationSignature({...payload,...patch},key),/Invalid/);
  await assert.rejects(()=>verifyMidtransNotificationSignature(payload,""),/Invalid/);
});
