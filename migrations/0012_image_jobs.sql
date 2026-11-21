-- Image credits are separate from daily chat quotas. No automatic grants or payments.
CREATE TABLE image_wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0 AND balance <= 9007199254740991),
  updated_at INTEGER NOT NULL
);
CREATE TABLE image_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('generate','edit')),
  prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  output_format TEXT NOT NULL,
  size TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','processing','completed','failed','expired')),
  source_key TEXT,
  source_mime TEXT,
  output_key TEXT,
  output_bytes INTEGER,
  credits INTEGER NOT NULL CHECK (credits > 0),
  tariff_version TEXT NOT NULL,
  error_code TEXT,
  usage_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE(user_id, request_id)
);
CREATE INDEX image_jobs_created ON image_jobs(created_at);
CREATE INDEX image_jobs_owner ON image_jobs(user_id, created_at DESC);
CREATE INDEX image_jobs_cleanup ON image_jobs(status, updated_at);
CREATE TABLE image_credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_id TEXT REFERENCES image_jobs(id) ON DELETE CASCADE,
  event TEXT NOT NULL CHECK (event IN ('reserve','refund','grant')),
  delta INTEGER NOT NULL,
  reference TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  UNIQUE(job_id, event)
);
-- Database triggers make reserve/refund indivisible with job transitions,
-- including concurrent submissions and duplicate queue delivery.
CREATE TRIGGER image_reserve BEFORE INSERT ON image_jobs BEGIN
  SELECT CASE WHEN COALESCE((SELECT balance FROM image_wallets WHERE user_id=NEW.user_id),0) < NEW.credits
    THEN RAISE(ABORT, 'image_insufficient_credits') END;
END;
CREATE TRIGGER image_reserve_debit AFTER INSERT ON image_jobs BEGIN
  UPDATE image_wallets SET balance=balance-NEW.credits, updated_at=NEW.created_at WHERE user_id=NEW.user_id;
  INSERT INTO image_credit_ledger(user_id,job_id,event,delta,created_at)
    VALUES(NEW.user_id,NEW.id,'reserve',-NEW.credits,NEW.created_at);
END;
CREATE TRIGGER image_refund AFTER UPDATE OF status ON image_jobs
WHEN NEW.status='failed' AND OLD.status IN ('queued','processing') BEGIN
  UPDATE image_wallets SET balance=balance+NEW.credits, updated_at=NEW.updated_at WHERE user_id=NEW.user_id;
  INSERT INTO image_credit_ledger(user_id,job_id,event,delta,created_at)
    VALUES(NEW.user_id,NEW.id,'refund',NEW.credits,NEW.updated_at);
END;
CREATE TRIGGER image_grant AFTER INSERT ON image_credit_ledger
WHEN NEW.event='grant' AND NEW.delta>0 BEGIN
  INSERT INTO image_wallets(user_id,balance,updated_at) VALUES(NEW.user_id,NEW.delta,NEW.created_at)
    ON CONFLICT(user_id) DO UPDATE SET balance=balance+NEW.delta,updated_at=NEW.created_at;
END;

-- This aggregate has NO user identifier or job FK. It must survive account
-- deletion, expiry and normal retention cleanup so the lifetime pilot ceiling
-- and an uncertain charge cannot silently reset.
CREATE TABLE image_pilot_meter (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  admitted_count INTEGER NOT NULL DEFAULT 0 CHECK (admitted_count >= 0 AND admitted_count <= 9007199254740991),
  unsettled_calls INTEGER NOT NULL DEFAULT 0 CHECK (unsettled_calls IN (0,1)),
  provider_hold INTEGER NOT NULL DEFAULT 0 CHECK (provider_hold IN (0,1)),
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO image_pilot_meter(singleton,admitted_count,unsettled_calls,provider_hold,updated_at)
  VALUES(1,0,0,0,0);
-- Image job creation and lifetime count increment are one atomic D1 write.
-- Deleting a user/job does not decrement this operator-owned counter.
CREATE TRIGGER image_pilot_admit AFTER INSERT ON image_jobs BEGIN
  UPDATE image_pilot_meter SET admitted_count=admitted_count+1,updated_at=NEW.created_at WHERE singleton=1;
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'image_pilot_meter_unavailable') END;
END;
-- A billing-uncertain failure must durably pause the pilot even if
-- the originating user subsequently requests deletion of their account.
CREATE TRIGGER image_pilot_hold AFTER UPDATE OF error_code ON image_jobs
WHEN NEW.error_code='image_provider_billing_unverified' BEGIN
  UPDATE image_pilot_meter SET provider_hold=1,updated_at=NEW.updated_at WHERE singleton=1;
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'image_pilot_meter_unavailable') END;
END;
