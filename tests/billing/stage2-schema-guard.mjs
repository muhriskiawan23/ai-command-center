// The remote Cloudflare D1 service creates its own reserved _cf_KV table.
// This is NOT an app table and cannot be queried by customers. Ignore only
// that exact name on --remote; every other non-SQLite table remains a blocker.
import assert from "node:assert/strict";

export function assertFreshSandboxTables(tables, isRemote) {
  assert.ok(Array.isArray(tables), "D1 schema inventory must return a list");
  const unexpected = tables.filter((table) => !(isRemote && table?.name === "_cf_KV"));
  assert.equal(unexpected.length, 0,
    "Proof requires a NEW EMPTY sandbox database, never an existing app database");
}
