-- Daily pseudonymous counters. Additive to the original global admission ledger.
CREATE TABLE IF NOT EXISTS web_search_v2_user_usage (
  day TEXT NOT NULL,
  subject TEXT NOT NULL CHECK (length(subject) = 64),
  calls INTEGER NOT NULL CHECK (calls > 0),
  reserved_micro_usd INTEGER NOT NULL CHECK (reserved_micro_usd > 0),
  PRIMARY KEY (day, subject)
);

CREATE TRIGGER IF NOT EXISTS web_search_v2_user_usage_insert
AFTER INSERT ON web_search_v2_user_usage
BEGIN
  INSERT INTO web_search_v2_usage (day, calls, reserved_micro_usd)
  VALUES (NEW.day, NEW.calls, NEW.reserved_micro_usd)
  ON CONFLICT(day) DO UPDATE SET
    calls = calls + excluded.calls,
    reserved_micro_usd = reserved_micro_usd + excluded.reserved_micro_usd;
END;

CREATE TRIGGER IF NOT EXISTS web_search_v2_user_usage_update
AFTER UPDATE OF calls, reserved_micro_usd ON web_search_v2_user_usage
BEGIN
  UPDATE web_search_v2_usage
  SET calls = calls + NEW.calls - OLD.calls,
      reserved_micro_usd = reserved_micro_usd + NEW.reserved_micro_usd - OLD.reserved_micro_usd
  WHERE day = NEW.day;
END;
