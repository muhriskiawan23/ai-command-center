-- FUTURE/INACTIVE: separate atomic provider spend budget for paid inference.
-- Requires provider_budget_limits rows for each approved provider AND __global__.
-- A missing cap fails closed. Do not apply to production without migration review.
CREATE TABLE IF NOT EXISTS provider_budget_limits (
  provider TEXT PRIMARY KEY NOT NULL,
  daily_cap_micro_usd INTEGER NOT NULL CHECK (daily_cap_micro_usd > 0 AND daily_cap_micro_usd <= 9007199254740991),
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS provider_budget_daily (
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  reserved_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (reserved_micro_usd >= 0 AND reserved_micro_usd <= 9007199254740991),
  spent_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (spent_micro_usd >= 0 AND spent_micro_usd <= 9007199254740991),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(day, provider)
);
CREATE TABLE IF NOT EXISTS provider_budget_reservations (
  id TEXT PRIMARY KEY NOT NULL,
  day TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  reserved_micro_usd INTEGER NOT NULL CHECK (reserved_micro_usd > 0 AND reserved_micro_usd <= 9007199254740991),
  actual_micro_usd INTEGER,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((status = 'reserved' AND actual_micro_usd IS NULL)
    OR (status = 'settled' AND actual_micro_usd IS NOT NULL
      AND actual_micro_usd >= 0 AND actual_micro_usd <= reserved_micro_usd))
);
CREATE INDEX IF NOT EXISTS idx_provider_budget_reservations_day
  ON provider_budget_reservations(day, provider, status);

CREATE TRIGGER IF NOT EXISTS trg_provider_budget_initial_state
BEFORE INSERT ON provider_budget_reservations
WHEN NEW.status != 'reserved' OR NEW.actual_micro_usd IS NOT NULL OR NEW.provider = '__global__'
BEGIN
  SELECT RAISE(ABORT, 'invalid_provider_budget_reservation');
END;

-- The two UPDATEs and the new reservation row are one statement transaction.
-- "__global__" caps aggregate spend across every provider and every user.
CREATE TRIGGER IF NOT EXISTS trg_provider_budget_reserve
BEFORE INSERT ON provider_budget_reservations
WHEN NEW.status = 'reserved'
BEGIN
  INSERT INTO provider_budget_daily(day,provider,reserved_micro_usd,spent_micro_usd,updated_at)
    VALUES (NEW.day,NEW.provider,0,0,NEW.created_at)
    ON CONFLICT(day,provider) DO NOTHING;
  UPDATE provider_budget_daily
    SET reserved_micro_usd = reserved_micro_usd + NEW.reserved_micro_usd, updated_at = NEW.created_at
    WHERE day = NEW.day AND provider = NEW.provider
      AND reserved_micro_usd <= 9007199254740991 - NEW.reserved_micro_usd
      AND reserved_micro_usd <=
        (SELECT daily_cap_micro_usd FROM provider_budget_limits WHERE provider = NEW.provider)
        - spent_micro_usd - NEW.reserved_micro_usd;
  SELECT RAISE(ABORT, 'provider_daily_budget_exceeded_or_unconfigured') WHERE changes() != 1;

  INSERT INTO provider_budget_daily(day,provider,reserved_micro_usd,spent_micro_usd,updated_at)
    VALUES (NEW.day,'__global__',0,0,NEW.created_at)
    ON CONFLICT(day,provider) DO NOTHING;
  UPDATE provider_budget_daily
    SET reserved_micro_usd = reserved_micro_usd + NEW.reserved_micro_usd, updated_at = NEW.created_at
    WHERE day = NEW.day AND provider = '__global__'
      AND reserved_micro_usd <= 9007199254740991 - NEW.reserved_micro_usd
      AND reserved_micro_usd <=
        (SELECT daily_cap_micro_usd FROM provider_budget_limits WHERE provider = '__global__')
        - spent_micro_usd - NEW.reserved_micro_usd;
  SELECT RAISE(ABORT, 'global_daily_budget_exceeded_or_unconfigured') WHERE changes() != 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_provider_budget_immutable
BEFORE UPDATE ON provider_budget_reservations
WHEN NEW.id != OLD.id OR NEW.day != OLD.day OR NEW.provider != OLD.provider
  OR NEW.model != OLD.model OR NEW.reserved_micro_usd != OLD.reserved_micro_usd
  OR NEW.created_at != OLD.created_at OR OLD.status != 'reserved'
  OR NEW.status != 'settled' OR NEW.actual_micro_usd IS NULL
  OR NEW.actual_micro_usd < 0 OR NEW.actual_micro_usd > OLD.reserved_micro_usd
BEGIN
  SELECT RAISE(ABORT, 'invalid_provider_budget_finalization');
END;
CREATE TRIGGER IF NOT EXISTS trg_provider_budget_no_delete
BEFORE DELETE ON provider_budget_reservations
BEGIN
  SELECT RAISE(ABORT, 'provider_budget_delete_forbidden');
END;

-- Reserving is conservative. Settlement converts reserved worst-case exposure
-- into measured spend. No budget is freed when provider outcome is unknown.
CREATE TRIGGER IF NOT EXISTS trg_provider_budget_settle
AFTER UPDATE OF status ON provider_budget_reservations
WHEN OLD.status = 'reserved' AND NEW.status = 'settled'
BEGIN
  UPDATE provider_budget_daily
    SET reserved_micro_usd = reserved_micro_usd - OLD.reserved_micro_usd,
        spent_micro_usd = spent_micro_usd + NEW.actual_micro_usd,
        updated_at = NEW.updated_at
    WHERE day = OLD.day AND provider = OLD.provider
      AND reserved_micro_usd >= OLD.reserved_micro_usd
      AND spent_micro_usd <= 9007199254740991 - NEW.actual_micro_usd;
  SELECT RAISE(ABORT, 'provider_budget_settle_corrupt') WHERE changes() != 1;
  UPDATE provider_budget_daily
    SET reserved_micro_usd = reserved_micro_usd - OLD.reserved_micro_usd,
        spent_micro_usd = spent_micro_usd + NEW.actual_micro_usd,
        updated_at = NEW.updated_at
    WHERE day = OLD.day AND provider = '__global__'
      AND reserved_micro_usd >= OLD.reserved_micro_usd
      AND spent_micro_usd <= 9007199254740991 - NEW.actual_micro_usd;
  SELECT RAISE(ABORT, 'global_budget_settle_corrupt') WHERE changes() != 1;
END;
