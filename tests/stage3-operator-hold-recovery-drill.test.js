// INACTIVE Stage 3 operator recovery drill. Purely synthetic, local in-memory
// SQLite using the real (UNAPPLIED) Stage 2/3 D1 SQL and adapters.
// This is NOT an operator endpoint or an authorization to alter real balances.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { reserveCredits, finalizeCredits } from "../src/credit-ledger.js";
import { reserveProviderSpend, settleProviderSpend } from "../src/provider-spend-budget.js";
import { appendProviderUsageEvent } from "../src/provider-usage-journal.js";
import { inspectStage3HoldTriage } from "../src/stage3-hold-triage.js";
import { inspectStage3CrossLedgerReconciliation } from "../src/stage3-cross-ledger-reconciliation.js";

const NOW = 1_735_000_000_000;
const USER = "synthetic-recovery-user";
const REQUEST = "synthetic-recovery-request";
const ATTEMPT = "synthetic-attempt-1";
const PROVIDER = "cloudflare-workers-ai";
const MODEL = "@cf/synthetic-recovery";
const tariff = Object.freeze({
  approved: true, version: "synthetic-recovery-v1",
  provider: PROVIDER, model: MODEL,
  inputRateMicroUsdPerMillion: 293000n,
  outputRateMicroUsdPerMillion: 2253000n
});
const migrations = [
  "../migrations/0012_credit_ledger.sql",
  "../migrations/0013_provider_spend_budget.sql",
  "../migrations/0014_provider_usage_journal.sql"
];

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  for (const path of migrations)
    sqlite.exec(readFileSync(new URL(path, import.meta.url), "utf8"));
  sqlite.prepare("INSERT INTO credit_accounts (user_id,balance_microcredits,updated_at) VALUES (?,?,1)")
    .run(USER, 100000);
  for (const provider of [PROVIDER, "__global__"])
    sqlite.prepare("INSERT INTO provider_budget_limits (provider,daily_cap_micro_usd,updated_at) VALUES (?,?,1)")
      .run(provider, 100000);
  const statement = (sql, args = []) => ({
    bind(...params) { return statement(sql, params); },
    first: async () => sqlite.prepare(sql).get(...args),
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } })
  });
  const env = { DB: { prepare: sql => statement(sql) } };
  const one = (sql, ...args) => sqlite.prepare(sql).get(...args);
  const setupHolds = async () => {
    const budget = await reserveProviderSpend(env, {
      id: "ai:" + REQUEST, provider: PROVIDER, model: MODEL,
      maximumMicroUsd: 9000n, nowMs: NOW
    });
    const wallet = await reserveCredits(env, {
      userId: USER, requestId: REQUEST,
      amountMicrocredits: 9000n, now: Math.floor(NOW / 1000)
    });
    assert.equal(budget.ok, true);
    assert.equal(wallet.ok, true);
  };
  const journal = async (kind, attemptId = ATTEMPT) => {
    const result = await appendProviderUsageEvent(env, {
      attemptId, requestId: REQUEST, provider: PROVIDER,
      model: MODEL, rateVersion: tariff.version, kind,
      ...(kind === "usage_measured"
        ? { usage: { prompt_tokens: 1000, completion_tokens: 100 }, tariff }
        : {}),
      nowMs: NOW + 1000
    });
    assert.equal(result.ok, true);
  };
  const holdAudit = () => inspectStage3HoldTriage(env, {
    nowMs: NOW + 7200000, staleAfterSeconds: 60
  });
  const ledgerAudit = () => inspectStage3CrossLedgerReconciliation(env, {
    nowMs: NOW + 7200000, staleAfterSeconds: 60
  });
  const budgetSettle = amount => settleProviderSpend(env, {
    id: "ai:" + REQUEST, actualMicroUsd: amount, nowMs: NOW + 2000
  });
  const walletSettle = amount => finalizeCredits(env, {
    userId: USER, requestId: REQUEST,
    settledMicrocredits: amount, now: Math.floor((NOW + 2000) / 1000)
  });
  const walletRelease = () => finalizeCredits(env, {
    userId: USER, requestId: REQUEST,
    now: Math.floor((NOW + 2000) / 1000)
  });
  const balance = () => one(
    "SELECT balance_microcredits AS amount FROM credit_accounts WHERE user_id=?", USER
  ).amount;
  const reservation = () => one(
    "SELECT status,settled_microcredits FROM credit_reservations WHERE request_id=?", REQUEST
  );
  const budgetState = () => one(
    "SELECT status,actual_micro_usd FROM provider_budget_reservations WHERE id=?", "ai:" + REQUEST
  );
  const refundCount = () => one(
    "SELECT COUNT(*) AS n FROM credit_ledger WHERE user_id=? AND reason='refund' AND reference_id=?",
    USER, REQUEST
  ).n;
  return {
    sqlite, env, one, setupHolds, journal, holdAudit, ledgerAudit,
    budgetSettle, walletSettle, walletRelease, balance,
    reservation, budgetState, refundCount
  };
}

// Test-only simulation of an independent signoff. Actual operator identity,
// provider statements and approvals are NOT checked by this helper.
function simulateTwoIndependentHumanReviews(first, second, evidence, expectedMicroUsd) {
  assert.notEqual(first, second);
  assert.equal(evidence.account, USER);
  assert.equal(evidence.request, REQUEST);
  assert.equal(evidence.provider, PROVIDER);
  assert.equal(evidence.model, MODEL);
  assert.equal(evidence.rateVersion, tariff.version);
  assert.equal(evidence.externallyVerified, true);
  assert.equal(Number.isSafeInteger(expectedMicroUsd) && expectedMicroUsd >= 0, true);
  assert.equal(evidence.invoiceCostMicroUsd, expectedMicroUsd);
}
function syntheticEvidence(extra = {}) {
  return {
    account: USER, request: REQUEST, provider: PROVIDER,
    model: MODEL, rateVersion: tariff.version,
    externallyVerified: true, invoiceCostMicroUsd: 519, ...extra
  };
}
function verifySafeFinal(x) {
  assert.equal(x.balance(), 99481);
  assert.equal(x.reservation().status, "settled");
  assert.equal(x.reservation().settled_microcredits, 519);
  assert.equal(x.budgetState().status, "settled");
  assert.equal(x.budgetState().actual_micro_usd, 519);
  assert.equal(x.refundCount(), 1);
}

test("after provider settled, two-reviewed synthetic wallet recovery is single-charge and replay-safe", async t => {
  const x = fixture(t);
  await x.setupHolds();
  await x.journal("dispatched");
  await x.journal("usage_measured");
  assert.equal((await x.budgetSettle(519n)).ok, true);
  const before = await x.holdAudit();
  assert.equal(before.creditFinalizationPending, 1);
  assert.equal(before.providerInvoiceVerified, false);
  assert.equal(x.balance(), 91000);

  simulateTwoIndependentHumanReviews("reviewer-A", "reviewer-B", syntheticEvidence(), 519);
  assert.equal((await x.walletSettle(519n)).ok, true);
  verifySafeFinal(x);
  assert.equal((await x.walletSettle(519n)).ok, false);
  assert.equal((await x.walletRelease()).ok, false);
  verifySafeFinal(x);
  assert.equal((await x.holdAudit()).reviewRequired, false);
  assert.equal((await x.ledgerAudit()).reviewRequired, false);
});

test("measured provider-budget hold resolves in provider-then-wallet order without double spending", async t => {
  const x = fixture(t);
  await x.setupHolds();
  await x.journal("dispatched");
  await x.journal("usage_measured");
  assert.equal((await x.holdAudit()).measuredPendingProviderSettlement, 1);
  const before = await x.ledgerAudit();
  assert.equal(before.measuredBudgetStillHeld, 1);

  simulateTwoIndependentHumanReviews("finance", "security", syntheticEvidence(), 519);
  assert.equal((await x.budgetSettle(519n)).ok, true);
  assert.equal((await x.holdAudit()).creditFinalizationPending, 1);
  assert.equal((await x.walletSettle(519n)).ok, true);
  verifySafeFinal(x);
  assert.equal((await x.budgetSettle(519n)).ok, false);
  assert.equal((await x.walletSettle(519n)).ok, false);
  const daily = x.sqlite.prepare(
    "SELECT provider,reserved_micro_usd,spent_micro_usd FROM provider_budget_daily ORDER BY provider"
  ).all();
  assert.equal(daily.length, 2);
  assert.ok(daily.every(row => row.reserved_micro_usd === 0 && row.spent_micro_usd === 519));
  assert.equal((await x.ledgerAudit()).reviewRequired, false);
});

test("synthetic pre-dispatch confirmed no-invocation case can release once, only after manual review", async t => {
  const x = fixture(t);
  await x.setupHolds();
  assert.equal((await x.holdAudit()).stalePreDispatchDualHolds, 1);
  assert.equal(x.one("SELECT COUNT(*) AS n FROM provider_usage_events").n, 0);
  assert.equal(x.balance(), 91000);
  // In a real incident journal absence alone does NOT prove no provider usage.
  simulateTwoIndependentHumanReviews("operator", "independent-finance", syntheticEvidence({
    noProviderInvocationAttested: true, invoiceCostMicroUsd: 0
  }), 0);
  assert.equal((await x.budgetSettle(0n)).ok, true);
  assert.equal((await x.walletRelease()).ok, true);
  assert.equal(x.balance(), 100000);
  assert.equal(x.reservation().status, "released");
  assert.equal(x.refundCount(), 1);
  assert.equal((await x.budgetSettle(0n)).ok, false);
  assert.equal((await x.walletRelease()).ok, false);
  assert.equal(x.balance(), 100000);
  assert.equal((await x.holdAudit()).reviewRequired, false);
  assert.equal((await x.ledgerAudit()).reviewRequired, false);
});

for (const kind of ["outcome_unknown", "usage_unverified"]) {
  test("missing authoritative upstream evidence (" + kind + ") stays held, even when stale", async t => {
    const x = fixture(t);
    await x.setupHolds();
    await x.journal("dispatched");
    await x.journal(kind);
    const before = await x.holdAudit();
    assert.equal(before.reviewRequired, true);
    assert.equal(before.providerInvoiceVerified, false);
    assert.equal(kind === "outcome_unknown" ? before.unknownProviderHolds : before.unverifiedUsageHolds, 1);
    // No recovery write is allowed under this evidence state.
    assert.equal(x.balance(), 91000);
    assert.equal(x.budgetState().status, "reserved");
    assert.equal(x.reservation().status, "reserved");
    assert.equal(x.refundCount(), 0);
    assert.equal((await x.ledgerAudit()).reviewRequired, true);
  });
}

test("stale dispatch with no terminal outcome stays held, including across a later measured retry", async t => {
  const x = fixture(t);
  await x.setupHolds();
  await x.journal("dispatched");
  await x.journal("dispatched", "synthetic-attempt-2");
  await x.journal("usage_measured", "synthetic-attempt-2");
  const before = await x.holdAudit();
  assert.equal(before.staleDispatchesWithoutOutcome, 1);
  assert.equal(before.measuredPendingProviderSettlement, 1);
  const cross = await x.ledgerAudit();
  assert.ok(cross.staleUnmeasuredAttempts >= 1);
  assert.equal(x.budgetState().status, "reserved");
  assert.equal(x.reservation().status, "reserved");
  assert.equal(x.refundCount(), 0);
});

test("wrong provider cost or zero-cost dispatch remains escalated, not incorrectly cleared", async t => {
  const x = fixture(t);
  await x.setupHolds();
  await x.journal("dispatched");
  await x.journal("usage_measured");
  assert.equal((await x.budgetSettle(520n)).ok, true);
  const audit = await x.holdAudit();
  assert.equal(audit.settledMeasuredCostMismatch, 1);
  assert.equal((await x.ledgerAudit()).settledCostMismatches, 1);
  assert.equal(x.reservation().status, "reserved");
  assert.equal(x.balance(), 91000);
  assert.equal(x.refundCount(), 0);
  // One-way settlement must not be overwritten to hide a discrepancy.
  assert.equal((await x.budgetSettle(519n)).ok, false);

  const y = fixture(t);
  await y.setupHolds();
  await y.journal("dispatched");
  await y.journal("usage_measured");
  assert.equal((await y.budgetSettle(0n)).ok, true);
  assert.equal((await y.ledgerAudit()).zeroSettledBudgetAfterDispatch, 1);
  assert.equal((await y.holdAudit()).settledMeasuredCostMismatch, 1);
  assert.equal(y.reservation().status, "reserved");
  assert.equal(y.refundCount(), 0);
});

test("review simulation refuses identical reviewers or wrong account and cost is never guessed", async t => {
  const x = fixture(t);
  await x.setupHolds();
  await x.journal("dispatched");
  await x.journal("outcome_unknown");
  assert.throws(() => simulateTwoIndependentHumanReviews(
    "same", "same", syntheticEvidence(), 519
  ));
  assert.throws(() => simulateTwoIndependentHumanReviews(
    "one", "two", syntheticEvidence({ account: "other" }), 519
  ));
  assert.throws(() => simulateTwoIndependentHumanReviews(
    "one", "two", syntheticEvidence({ externallyVerified: false }), 519
  ));
  assert.throws(() => simulateTwoIndependentHumanReviews(
    "one", "two", syntheticEvidence({ invoiceCostMicroUsd: 520 }), 519
  ));
  assert.equal(x.balance(), 91000);
  assert.equal(x.refundCount(), 0);
});
