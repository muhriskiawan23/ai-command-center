-- STAGING ONLY. Aggregated callback HTTP attempt telemetry, never customer/payment records.
-- All categories are server-controlled strings; no payloads, IDs, IPs or signed fields.
-- One row per 5-minute interval/disposition/category, bounded by named categories.
CREATE TABLE staging_callback_diagnostic_buckets (
  window_start_ms INTEGER NOT NULL CHECK(window_start_ms>=0),
  disposition TEXT NOT NULL CHECK(disposition IN ('accepted','retry','rejected')),
  category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 64),
  hits INTEGER NOT NULL CHECK(hits BETWEEN 1 AND 1000000),
  last_seen_ms INTEGER NOT NULL CHECK(last_seen_ms>=window_start_ms),
  PRIMARY KEY(window_start_ms, disposition, category)
) WITHOUT ROWID;
-- Operator queries use time-bounded ranges. No relation to production tables.
