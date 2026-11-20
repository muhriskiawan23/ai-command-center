-- Read-only status schema for the dedicated production/sandbox shadow D1.
-- The guarded production workflow applies this only to the explicitly supplied
-- bor-ai-billing-shadow database after verifying its account, name, ID, and secret.
-- Never use this schema on bor-ai-chat or bor-ai-billing-staging.
CREATE TABLE IF NOT EXISTS billing_shadow_attestation (
  id INTEGER PRIMARY KEY CHECK(id=1),
  service TEXT NOT NULL CHECK(service='bor-billing-shadow-readonly'),
  database_name TEXT NOT NULL CHECK(database_name='bor-ai-billing-shadow'),
  schema_version INTEGER NOT NULL CHECK(schema_version=1)
);
INSERT OR IGNORE INTO billing_shadow_attestation(id,service,database_name,schema_version)
VALUES(1,'bor-billing-shadow-readonly','bor-ai-billing-shadow',1);

-- Not a payable entitlement, customer balance or payment record.
-- No Google IDs/emails, callback signatures, PII, tokens or monetary data.
-- subject_hash is an HMAC of the independently authenticated Google sub,
-- computed with a distinct shadow-only secret (not the login cookie secret).
CREATE TABLE IF NOT EXISTS billing_shadow_accounts (
  subject_hash TEXT PRIMARY KEY NOT NULL
    CHECK(length(subject_hash)=64 AND subject_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL
    CHECK(status IN ('not_enrolled','under_review','blocked')),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0),
  updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms>=created_at_ms)
);
-- The public Worker implementation in src/billing-account-shadow.js has
-- SELECT statements only; it cannot create or mutate shadow account statuses.
