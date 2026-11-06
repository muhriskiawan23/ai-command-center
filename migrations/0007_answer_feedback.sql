CREATE TABLE IF NOT EXISTS answer_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('helpful', 'not_helpful')),
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_answer_feedback_user_created
  ON answer_feedback(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_answer_feedback_conversation
  ON answer_feedback(conversation_id, user_id);
