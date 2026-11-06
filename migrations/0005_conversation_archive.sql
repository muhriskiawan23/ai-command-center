-- Keep archived conversations and their messages; archive is reversible and account-scoped.
ALTER TABLE conversations
  ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1));

CREATE INDEX IF NOT EXISTS idx_conversations_user_archived_pinned_updated
  ON conversations(user_id, archived, pinned DESC, updated_at DESC);
