import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");

function fundedOrder(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(read("../tools/midtrans-sandbox/credit-fixture.sql"));
  db.exec(read("../docs/sql/payment-orders-review.sql"));
  db.exec(read("../docs/sql/payment-reversals-review.sql"));
  db.exec(`
    INSERT INTO payment_orders VALUES ('order','tester','fixture','sandbox','IDR',10000,25,'created',NULL,1,1);
    UPDATE payment_orders SET state='paid_unfulfilled',provider_transaction_id='tx' WHERE order_id='order';
    UPDATE payment_orders SET state='fulfilled' WHERE order_id='order';
  `);
  const apply = (kind, transactionId = "tx", amount = 10000) => db.prepare(
    "INSERT INTO sandbox_payment_reversals (order_id,provider_transaction_id,kind,amount_idr,created_at) VALUES ('order',?,?,?,2) ON CONFLICT(order_id) DO NOTHING"
  ).run(transactionId, kind, amount);
  const balance = () => db.prepare("SELECT balance_microcredits AS balance FROM credit_accounts").get().balance;
  const ledger = () => db.prepare("SELECT delta_microcredits AS delta FROM credit_ledger ORDER BY created_at").all().map(row => row.delta);
  const state = () => db.prepare("SELECT state FROM payment_orders").get().state;
  return { db, apply, balance, ledger, state };
}

test("full refund reverses the credit once, including a later chargeback replay", t => {
  const { apply, balance, ledger, state } = fundedOrder(t);
  apply("refund");
  apply("refund");
  apply("chargeback");
  assert.equal(state(), "refunded");
  assert.equal(balance(), 0);
  assert.deepEqual(ledger(), [25, -25]);
});

test("chargeback with spent credit records a review without a negative balance", t => {
  const { db, apply, balance, ledger, state } = fundedOrder(t);
  db.exec("UPDATE credit_accounts SET balance_microcredits=5");
  db.exec("INSERT INTO credit_ledger VALUES ('spend','tester',-20,'usage','fixture-request',2)");
  apply("chargeback");
  assert.equal(state(), "disputed");
  assert.equal(balance(), 5);
  assert.deepEqual(ledger(), [25, -20]);
  assert.equal(db.prepare("SELECT outcome FROM sandbox_payment_reversals").get().outcome, "review_required");
});

test("transaction mismatch or partial refund leaves balance and ledger untouched", t => {
  const { apply, balance, ledger, state } = fundedOrder(t);
  assert.throws(() => apply("refund", "other"), /sandbox_reversal_mismatch/);
  assert.throws(() => apply("refund", "tx", 1000), /sandbox_reversal_mismatch/);
  assert.equal(state(), "fulfilled");
  assert.equal(balance(), 25);
  assert.deepEqual(ledger(), [25]);
});

test("a ledger collision rolls back reversal and balance", t => {
  const { db, apply, balance, state } = fundedOrder(t);
  db.exec("INSERT INTO credit_ledger VALUES ('reversal:order','tester',1,'fixture_conflict','different',2)");
  assert.throws(() => apply("refund"), /UNIQUE/);
  assert.equal(state(), "fulfilled");
  assert.equal(balance(), 25);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sandbox_payment_reversals").get().n, 0);
});

test("an expired unpaid order creates no credit or ledger entry", t => {
  const { db, balance, ledger } = fundedOrder(t);
  db.exec(`
    INSERT INTO payment_orders VALUES ('expired-order','tester','fixture','sandbox','IDR',10000,25,'created',NULL,3,3);
    UPDATE payment_orders SET state='expired' WHERE order_id='expired-order';
  `);
  assert.equal(db.prepare("SELECT state FROM payment_orders WHERE order_id='expired-order'").get().state, "expired");
  assert.equal(balance(), 25);
  assert.deepEqual(ledger(), [25]);
});

test("direct refund or dispute SQL cannot forge a verified reversal",t=>{
 const {db,balance,ledger,state}=fundedOrder(t);
 for(const target of ["refunded","disputed"]){
  assert.throws(
   ()=>db.prepare("UPDATE payment_orders SET state=?,updated_at=3 WHERE order_id='order'").run(target),
   /sandbox_reversal_evidence_required/
  );
 }
 assert.equal(state(),"fulfilled");
 assert.equal(balance(),25);
 assert.deepEqual(ledger(),[25]);
 assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sandbox_payment_reversals").get().n,0);
});
test("paid-but-unfulfilled sandbox order cannot be marked refunded or disputed without ledger proof",t=>{
 const {db}=fundedOrder(t);
 db.exec(`
   INSERT INTO payment_orders VALUES ('unfulfilled','tester','fixture','sandbox','IDR',10000,25,'created',NULL,4,4);
   UPDATE payment_orders SET state='paid_unfulfilled',provider_transaction_id='tx2' WHERE order_id='unfulfilled';
 `);
 for(const target of ["refunded","disputed"]){
  assert.throws(
   ()=>db.prepare("UPDATE payment_orders SET state=? WHERE order_id='unfulfilled'").run(target),
   /sandbox_reversal_evidence_required/
  );
 }
 assert.equal(db.prepare("SELECT state FROM payment_orders WHERE order_id='unfulfilled'").get().state,"paid_unfulfilled");
});
test("full refund after spent credits still records review without a negative account",t=>{
 const {db,apply,balance,ledger,state}=fundedOrder(t);
 db.exec("UPDATE credit_accounts SET balance_microcredits=5");
 db.exec("INSERT INTO credit_ledger VALUES ('spent','tester',-20,'usage','spent-before-refund',3)");
 apply("refund");
 assert.equal(state(),"refunded");
 assert.equal(balance(),5);
 assert.deepEqual(ledger(),[25,-20]);
 assert.equal(db.prepare("SELECT outcome FROM sandbox_payment_reversals").get().outcome,"review_required");
});

test("confirmed reversal decision is append-only and cannot be deleted or rewritten",t=>{
 const {db,apply,balance,ledger,state}=fundedOrder(t);
 apply("refund");
 const first=db.prepare("SELECT outcome,amount_idr,kind FROM sandbox_payment_reversals WHERE order_id='order'").get();
 assert.equal(first.outcome,"reversed");
 for(const statement of [
  "UPDATE sandbox_payment_reversals SET outcome='review_required' WHERE order_id='order'",
  "UPDATE sandbox_payment_reversals SET amount_idr=1 WHERE order_id='order'",
  "UPDATE sandbox_payment_reversals SET kind='chargeback' WHERE order_id='order'"
 ])assert.throws(()=>db.exec(statement),/sandbox_reversal_append_only/);
 assert.throws(()=>db.exec("DELETE FROM sandbox_payment_reversals WHERE order_id='order'"),
   /sandbox_reversal_delete_forbidden/);
 assert.deepEqual(db.prepare("SELECT outcome,amount_idr,kind FROM sandbox_payment_reversals WHERE order_id='order'").get(),first);
 assert.equal(state(),"refunded");
 assert.equal(balance(),0);
 assert.deepEqual(ledger(),[25,-25]);
});
test("dispute review markers cannot be overwritten or deleted",t=>{
 const {db,apply,balance,ledger,state}=fundedOrder(t);
 db.exec("UPDATE credit_accounts SET balance_microcredits=5");
 db.exec("INSERT INTO credit_ledger VALUES ('spend','tester',-20,'usage','fixture-spend',3)");
 apply("chargeback");
 db.exec("INSERT INTO sandbox_payment_reversal_reviews (order_id,provider_status,created_at) VALUES ('order','chargeback',4)");
 for(const sql of [
  "UPDATE sandbox_payment_reversal_reviews SET created_at=99 WHERE order_id='order'",
  "UPDATE sandbox_payment_reversal_reviews SET provider_status='refund' WHERE order_id='order'"
 ])assert.throws(()=>db.exec(sql),/sandbox_reversal_review_append_only/);
 assert.throws(()=>db.exec("DELETE FROM sandbox_payment_reversal_reviews WHERE order_id='order'"),
   /sandbox_reversal_review_delete_forbidden/);
 assert.deepEqual(db.prepare("SELECT provider_status,created_at FROM sandbox_payment_reversal_reviews").get(),
   {provider_status:"chargeback",created_at:4});
 assert.equal(db.prepare("SELECT outcome FROM sandbox_payment_reversals").get().outcome,"review_required");
 assert.equal(state(),"disputed");
 assert.equal(balance(),5);
 assert.deepEqual(ledger(),[25,-20]);
});
