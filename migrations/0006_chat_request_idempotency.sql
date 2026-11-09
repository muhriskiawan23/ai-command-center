-- A retry from the same signed-in account reuses its request key and replays the saved assistant turn.
ALTER TABLE messages ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX idx_messages_user_idempotency
  ON messages(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
