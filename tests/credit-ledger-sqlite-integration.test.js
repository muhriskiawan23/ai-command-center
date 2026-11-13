import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const schema = readFileSync(new URL("../migrations/0012_credit_ledger.sql", import.meta.url), "utf8");
function setup(balance = 100) {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  db.prepare("INSERT INTO credit_accounts (user_id,balance_microcredits,updated_at) VALUES (?,?,?)").run("user",balance,1);
  return db;
}
function balance(db) {
  return db.prepare("SELECT balance_microcredits AS balance FROM credit_accounts WHERE user_id = 'user'").get().balance;
}
function count(db,table) {return db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;}
function reserve(db,id,amount) {
  return db.prepare("INSERT INTO credit_reservations (request_id,user_id,reserved_microcredits,settled_microcredits,status,created_at,updated_at) VALUES (?, 'user', ?, NULL, 'reserved', 2, 2)").run(id,amount);
}
function finish(db,id,status,settled) {
  return db.prepare("UPDATE credit_reservations SET status=?,settled_microcredits=?,updated_at=3 WHERE request_id=? AND user_id='user' AND status='reserved'").run(status,settled,id);
}
test("SQLite real transaction: reserve, settle and refund exact unused credits", () => {
  const db=setup();
  try {
    reserve(db,"r1",60);
    assert.equal(balance(db),40);
    assert.equal(count(db,"credit_ledger"),1);
    assert.equal(finish(db,"r1","settled",25).changes,1);
    assert.equal(balance(db),75);
    assert.equal(count(db,"credit_ledger"),2);
    assert.equal(db.prepare("SELECT sum(delta_microcredits) AS total FROM credit_ledger").get().total,-25);
    assert.equal(finish(db,"r1","released",null).changes,0);
    assert.equal(balance(db),75);
  } finally {db.close();}
});
test("SQLite real transaction: full release is idempotent", () => {
  const db=setup();
  try {
    reserve(db,"r2",90);
    assert.equal(finish(db,"r2","released",null).changes,1);
    assert.equal(balance(db),100);
    assert.equal(finish(db,"r2","released",null).changes,0);
    assert.equal(count(db,"credit_ledger"),2);
  } finally {db.close();}
});
test("SQLite real transaction: insufficient funds and duplicate requests do not debit", () => {
  const db=setup();
  try {
    assert.throws(()=>reserve(db,"over",101));
    assert.equal(balance(db),100);
    assert.equal(count(db,"credit_ledger"),0);
    reserve(db,"same",40);
    assert.throws(()=>reserve(db,"same",40));
    assert.equal(balance(db),60);
    assert.equal(count(db,"credit_ledger"),1);
  } finally {db.close();}
});
test("SQLite real transaction: finalization rejects oversettlement and terminal mutation", () => {
  const db=setup();
  try {
    reserve(db,"r3",50);
    assert.throws(()=>finish(db,"r3","settled",51));
    assert.equal(balance(db),50);
    assert.equal(finish(db,"r3","settled",50).changes,1);
    assert.throws(()=>db.prepare("UPDATE credit_reservations SET status='released',settled_microcredits=NULL WHERE request_id='r3'").run());
    assert.throws(()=>db.prepare("DELETE FROM credit_reservations WHERE request_id='r3'").run());
    assert.equal(balance(db),50);
  } finally {db.close();}
});
test("SQLite real transaction: cannot bypass debit with direct settled insertion", () => {
  const db=setup();
  try {
    assert.throws(()=>db.prepare("INSERT INTO credit_reservations VALUES ('fake','user',10,10,'settled',1,1)").run());
    assert.equal(balance(db),100);
    assert.equal(count(db,"credit_ledger"),0);
  } finally {db.close();}
});
