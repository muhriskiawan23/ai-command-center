import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reserveCredits, finalizeCredits, readCreditBalance } from "../src/credit-ledger.js";

const schema = readFileSync(new URL("../migrations/0012_credit_ledger.sql", import.meta.url), "utf8");
test("reservation trigger aborts insufficient balance and journals atomically", () => {
  assert.match(schema, /CREATE TRIGGER IF NOT EXISTS trg_credit_reservation_atomic/);
  assert.match(schema, /balance_microcredits >= NEW\.reserved_microcredits/);
  assert.match(schema, /RAISE\(ABORT, 'insufficient_credit_balance'\)/);
  assert.match(schema, /INSERT INTO credit_ledger/);
  assert.match(schema, /request_id TEXT PRIMARY KEY/);
});
test("reservation rejects invalid identifiers and amounts before D1 access", async () => {
  const env = { DB: { prepare() { throw Error("must not access DB"); } } };
  for (const request of [
    {userId:"",requestId:"req",amountMicrocredits:1n},
    {userId:"u",requestId:"",amountMicrocredits:1n},
    {userId:"u",requestId:"req",amountMicrocredits:0n},
    {userId:"u",requestId:"req",amountMicrocredits:1.5}
  ]) await assert.rejects(reserveCredits(env, request));
});
test("successful single-statement reservation and fail-closed DB error", async () => {
  let queries = [];
  const db = { prepare(sql) { queries.push(sql); return { bind(...args) { return { async run() { assert.equal(args[2], 7); return {meta:{changes:1}}; } }; } }; } };
  assert.deepEqual(await reserveCredits({DB:db},{userId:"u",requestId:"req",amountMicrocredits:7n,now:100}),{ok:true,reservedMicrocredits:7n});
  assert.equal(queries.length,1);
  assert.match(queries[0],/^INSERT INTO credit_reservations/);
  const failing = {DB:{prepare(){return {bind(){return {async run(){throw Error("D1 failure");}};}};}}};
  assert.deepEqual(await reserveCredits(failing,{userId:"u",requestId:"req",amountMicrocredits:7n}),{ok:false,reason:"reservation_rejected"});
});
test("balance reads reject corrupted or unsafe integers", async () => {
  const env = value => ({DB:{prepare(){return {bind(){return {first:async()=>({balance_microcredits:value})};}};}}});
  assert.equal(await readCreditBalance(env(100),"u"),100n);
  await assert.rejects(readCreditBalance(env(-1),"u"));
  await assert.rejects(readCreditBalance(env(Number.MAX_SAFE_INTEGER+1),"u"));
});

test("finalization uses one guarded UPDATE and rejects repeated or failed transitions", async () => {
  const queries = [];
  let changes = 1;
  const env = {DB:{prepare(sql){queries.push(sql);return {bind(...args){return {async run(){assert.deepEqual(args.slice(0,2),["settled",3]);return {meta:{changes}};}};}};}}};
  assert.deepEqual(await finalizeCredits(env,{userId:"u",requestId:"r",settledMicrocredits:3n,now:100}),{ok:true,status:"settled"});
  changes=0;
  assert.deepEqual(await finalizeCredits(env,{userId:"u",requestId:"r",settledMicrocredits:3n,now:101}),{ok:false,reason:"finalization_rejected"});
  assert.equal(queries.length,2);
  assert.match(queries[0],/WHERE request_id = \? AND user_id = \? AND status = 'reserved'/);
});
test("finalization rejects invalid settled amounts", async () => {
  const env = {DB:{prepare(){throw Error("must not query");}}};
  await assert.rejects(finalizeCredits(env,{userId:"u",requestId:"r",settledMicrocredits:-1n}));
  await assert.rejects(finalizeCredits(env,{userId:"u",requestId:"r",settledMicrocredits:1.5}));
});
test("SQL includes refund trigger and immutable terminal-state guard", () => {
  assert.match(schema,/trg_credit_reservation_finalize_guard/);
  assert.match(schema,/trg_credit_reservation_finalize_refund/);
  assert.match(schema,/OLD.status != 'reserved'/);
  assert.match(schema,/refund_account_missing_or_overflow/);
});
