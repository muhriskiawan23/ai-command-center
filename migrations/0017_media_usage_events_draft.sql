-- INACTIVE multimodal integration proof. Not applied remotely/production.
-- Opaque references only: no user identity, prompt, photo, video or output.
CREATE TABLE media_usage_events (
  attempt_id TEXT NOT NULL CHECK(length(attempt_id) BETWEEN 1 AND 120),
  event_kind TEXT NOT NULL CHECK(event_kind IN ('dispatched','usage_measured','outcome_unknown','usage_unverified')),
  request_id TEXT NOT NULL CHECK(length(request_id) BETWEEN 1 AND 120),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  rate_version TEXT NOT NULL,
  feature TEXT NOT NULL,
  provider_cost_micro_usd INTEGER,
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=0),
  PRIMARY KEY(attempt_id,event_kind),
  CHECK((event_kind='usage_measured' AND typeof(provider_cost_micro_usd)='integer'
    AND provider_cost_micro_usd>0 AND provider_cost_micro_usd<=9007199254740991)
    OR (event_kind!='usage_measured' AND provider_cost_micro_usd IS NULL))
);
CREATE INDEX idx_media_usage_request ON media_usage_events(request_id,event_kind);
CREATE TRIGGER trg_media_usage_insert_guard BEFORE INSERT ON media_usage_events
BEGIN
  -- REPLACE must never delete/rewrite an existing immutable event, including
  -- when recursive_triggers=OFF. Ordinary UNIQUE alone is insufficient.
  SELECT RAISE(ABORT,'media_event_append_only') WHERE EXISTS (
    SELECT 1 FROM media_usage_events e
    WHERE e.attempt_id=NEW.attempt_id AND e.event_kind=NEW.event_kind
  );
  SELECT RAISE(ABORT,'media_dispatch_mismatch')
  WHERE NEW.event_kind!='dispatched' AND NOT EXISTS (
    SELECT 1 FROM media_usage_events d WHERE d.attempt_id=NEW.attempt_id
      AND d.event_kind='dispatched' AND d.request_id=NEW.request_id
      AND d.provider=NEW.provider AND d.model=NEW.model
      AND d.rate_version=NEW.rate_version AND d.feature=NEW.feature
  );
  SELECT RAISE(ABORT,'media_event_already_measured')
  WHERE NEW.event_kind!='dispatched' AND EXISTS (
    SELECT 1 FROM media_usage_events e
    WHERE e.attempt_id=NEW.attempt_id AND e.event_kind='usage_measured'
  );
  -- Unknown/unverified usage is terminal until independent operator review.
  -- A late callback must never launder an uncertain attempt into an
  -- automatically measurable paid result or add a competing outcome.
  SELECT RAISE(ABORT,'media_event_terminal_conflict')
  WHERE NEW.event_kind!='dispatched' AND EXISTS (
    SELECT 1 FROM media_usage_events e
    WHERE e.attempt_id=NEW.attempt_id
      AND e.event_kind IN ('outcome_unknown','usage_unverified')
  );
END;
CREATE TRIGGER trg_media_usage_no_update BEFORE UPDATE ON media_usage_events
BEGIN SELECT RAISE(ABORT,'media_event_append_only'); END;
CREATE TRIGGER trg_media_usage_no_delete BEFORE DELETE ON media_usage_events
BEGIN SELECT RAISE(ABORT,'media_event_append_only'); END;
