-- INACTIVE Stage 3 prototype. Do NOT apply to production without an
-- independently reviewed migration, privacy policy, and founder approval.
-- Only opaque, server-issued request/attempt references; NEVER raw prompts,
-- completions, payment credentials, provider response bodies or customer PII.
-- All financial amounts are integer micro-USD, never floating point.
CREATE TABLE provider_usage_events (
  attempt_id TEXT NOT NULL,
  event_kind TEXT NOT NULL
    CHECK (event_kind IN ('dispatched','usage_measured','outcome_unknown','usage_unverified')),
  request_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  rate_version TEXT NOT NULL,
  input_tokens INTEGER CHECK (input_tokens >= 0 AND input_tokens <= 9007199254740991),
  output_tokens INTEGER CHECK (output_tokens >= 0 AND output_tokens <= 9007199254740991),
  provider_cost_micro_usd INTEGER
    CHECK (provider_cost_micro_usd >= 0 AND provider_cost_micro_usd <= 9007199254740991),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (attempt_id,event_kind),
  CHECK (
    (event_kind = 'usage_measured'
      AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL
      AND input_tokens + output_tokens > 0 AND provider_cost_micro_usd IS NOT NULL)
    OR
    (event_kind != 'usage_measured'
      AND input_tokens IS NULL AND output_tokens IS NULL
      AND provider_cost_micro_usd IS NULL)
  )
);
CREATE INDEX idx_provider_usage_events_request
  ON provider_usage_events(request_id, attempt_id);
CREATE INDEX idx_provider_usage_events_kind_time
  ON provider_usage_events(event_kind, created_at);

-- No terminal event without a matching prior dispatch, and no new
-- uncertainty after measured usage has been recorded. Unknown events may
-- be superseded by a later independently verified measured event.
CREATE TRIGGER trg_provider_usage_events_sequence
BEFORE INSERT ON provider_usage_events
WHEN NEW.event_kind != 'dispatched'
BEGIN
  SELECT RAISE(ABORT,'usage_event_missing_or_mismatched_dispatch')
  WHERE NOT EXISTS (
    SELECT 1 FROM provider_usage_events d
    WHERE d.attempt_id=NEW.attempt_id AND d.event_kind='dispatched'
      AND d.request_id=NEW.request_id AND d.provider=NEW.provider
      AND d.model=NEW.model AND d.rate_version=NEW.rate_version
  );
  SELECT RAISE(ABORT,'usage_event_already_metered')
  WHERE EXISTS (
    SELECT 1 FROM provider_usage_events m
    WHERE m.attempt_id=NEW.attempt_id AND m.event_kind='usage_measured'
  );
END;
CREATE TRIGGER trg_provider_usage_events_no_update
BEFORE UPDATE ON provider_usage_events
BEGIN
  SELECT RAISE(ABORT,'usage_event_append_only');
END;
CREATE TRIGGER trg_provider_usage_events_no_delete
BEFORE DELETE ON provider_usage_events
BEGIN
  SELECT RAISE(ABORT,'usage_event_append_only');
END;
