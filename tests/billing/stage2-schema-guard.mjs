// Cloudflare D1 remote has one reserved metadata table (_cf_KV).
// A crashed synthetic Stage 2 proof can leave fully imported migration schemas
// (but no customer/fixture rows). Resume ONLY exact known migration-only schemas.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const migrations = [
  new URL("../../migrations/0012_credit_ledger.sql", import.meta.url),
  new URL("../../migrations/0013_provider_spend_budget.sql", import.meta.url)
];

const query = "SELECT type,name,sql FROM sqlite_master " +
  "WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name";

function normalized(row) {
  assert.ok(row && typeof row.name === "string" &&
    typeof row.type === "string" && typeof row.sql === "string",
    "Unexpected or incomplete D1 schema entry");
  return [row.type, row.name, row.sql.replace(/\s+/g, " ").trim()];
}

function expectedStages() {
  const db = new DatabaseSync(":memory:");
  try {
    const snapshots = [];
    for (const path of migrations) {
      db.exec(readFileSync(path, "utf8"));
      snapshots.push(db.prepare(query).all().map(normalized));
    }
    return snapshots;
  } finally { db.close(); }
}

const [creditStage, budgetStage] = expectedStages();

function matches(actual, expected) {
  return actual.length === expected.length &&
    actual.every((row, i) => row.every((value, j) => value === expected[i][j]));
}

export function assertFreshSandboxTables(tables, isRemote) {
  assert.ok(Array.isArray(tables), "D1 schema inventory must return a list");
  const unexpected = tables.filter((table) => !(isRemote && table?.name === "_cf_KV"));
  assert.equal(unexpected.length, 0,
    "Proof requires a NEW EMPTY sandbox database, never an existing app database");
}

export function classifyStage2SandboxSchema(objects, isRemote) {
  assert.ok(Array.isArray(objects), "D1 schema inventory must return a list");
  const reserved = objects.filter(row => row?.name === "_cf_KV");
  assert.ok((!isRemote && reserved.length === 0) ||
    (isRemote && reserved.length <= 1 && reserved.every(row => row.type === "table")),
    "Unexpected reserved D1 metadata schema");
  const application = objects.filter(row => !(isRemote && row?.name === "_cf_KV"))
    .map(normalized);
  if (application.length === 0) return "empty";
  if (matches(application, creditStage)) return "credit_migrated";
  if (matches(application, budgetStage)) return "both_migrated";
  assert.fail("D1 schema differs from exact Stage 2 migration-only sandbox; refusing reuse");
}

export const stage2KnownTableNames = Object.freeze([
  "credit_accounts", "credit_ledger", "credit_reservations",
  "provider_budget_limits", "provider_budget_daily", "provider_budget_reservations"
]);
