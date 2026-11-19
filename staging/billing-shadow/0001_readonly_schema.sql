-- OFFLINE PROTOTYPE ONLY, NOT a migration for bor-ai-chat or
-- bor-ai-billing-staging. Never include in production D1 migrations.
-- Intended only for an independent future 'bor-ai-billing-shadow' database.
-- The live Worker has NO BILLING_SHADOW_DB binding or enabled flag.
CREATE TABLE billing_shadow_attestation (
  id INTEGER PRIMARY KEY CHECK(id=1),
  service TEXT NOT NULL CHECK(service='bor-billing-shadow-readonly'),
  database_name TEXT NOT NULL CHECK(database_name='bor-ai-billing-shadow'),
  schema_version INTEGER NOT NULL CHECK(schema_version=1)
);
INSERT INTO billing_shadow_attestation(id,service,database_name,schema_version)
VALUES(1,'bor-billing-shadow-readonly','bor-ai-billing-shadow',1);

-- Not a payable entitlement, customer balance or payment record.
-- No Google IDs/emails, callback signatures, PII, tokens or monetary data.
-- subject_hash is an HMAC of the independently authenticated Google sub,
-- computed with a distinct shadow-only secret (not the login cookie secret).
CREATE TABLE billing_shadow_accounts (
  subject_hash TEXT PRIMARY KEY NOT NULL
    CHECK(length(subject_hash)=64 AND subject_hash NOT GLOB '*[^0-9a-f]*'),
  status TEXT NOT NULL
    CHECK(status IN ('not_enrolled','under_review','blocked')),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms>=0),
  updated_at_ms INTEGER NOT NULL CHECK(updated_at_ms>=created_at_ms)
);
-- A separate privileged (future) operator process may provision these rows.
-- The public Worker implementation in src/billing-account-shadow.js has
-- SELECT statements only, and cannot create or mutate a shadow account.
