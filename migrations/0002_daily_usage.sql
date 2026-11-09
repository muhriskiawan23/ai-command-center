-- Daily usage counters (additive; existing tables and data are untouched).
-- One row per UTC day and subject:
--   'user:<google-sub>'  signed-in account
--   'guest:<hash>'       guest, identified only by a daily-rotating hash of the IP (raw IPs are never stored)
--   'global'             whole application (emergency brake against runaway AI cost)
-- `units` is the amount consumed that day: a normal message is 1, a multi-agent request is 3.
CREATE TABLE IF NOT EXISTS daily_usage (
  day TEXT NOT NULL,
  subject TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (day, subject)
);
CREATE INDEX IF NOT EXISTS idx_daily_usage_day ON daily_usage(day);
