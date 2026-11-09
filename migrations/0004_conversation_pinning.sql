-- Persist the user's explicit pinned state for each conversation.
ALTER TABLE conversations
  ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_conversations_user_pinned_updated
  ON conversations(user_id, pinned DESC, updated_at DESC);
