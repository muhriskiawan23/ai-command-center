"""Synthetic SQLite/D1 schema regression. No remote DB or user data used."""
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"


class PrivacyCascadeTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.db.execute("PRAGMA foreign_keys = ON")
        for migration in sorted(MIGRATIONS.glob("*.sql")):
            self.db.executescript(migration.read_text(encoding="utf-8"))
        self.db.execute("INSERT INTO users (id,email,created_at,updated_at) VALUES ('alice','a@example.test',1,1),('bob','b@example.test',1,1)")
        for user in ("alice", "bob"):
            self.db.execute("INSERT INTO conversations (id,user_id,created_at,updated_at) VALUES (?,?,1,1)", (f"{user}-conversation", user))
            self.db.execute("INSERT INTO messages (conversation_id,user_id,role,content,created_at,links_json) VALUES (?,?,'user',?,1,?)", (f"{user}-conversation", user, f"{user} sensitive synthetic URL https://example.test/?token=fake", '[{"sourceId":1,"ok":true}]'))
            message_id = self.db.execute("SELECT id FROM messages WHERE user_id=?", (user,)).fetchone()[0]
            self.db.execute("INSERT INTO answer_feedback (user_id,conversation_id,message_id,rating,created_at,updated_at) VALUES (?,?,?,'helpful',1,1)", (user, f"{user}-conversation", message_id))
            self.db.execute("INSERT INTO user_memories (id,user_id,content,created_at,updated_at) VALUES (?,?,?,1,1)", (f"{user}-memory", user, "synthetic"))
            self.db.execute("INSERT INTO public_api_keys (id,user_id,key_hash,label,allowed_origins,created_at,updated_at) VALUES (?,?,?,?,?,1,1)", (f"{user}-key", user, f"{user}-hash", "test", "[]"))
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def count(self, table, user):
        return self.db.execute(f"SELECT count(*) FROM {table} WHERE user_id=?", (user,)).fetchone()[0]

    def test_conversation_deletion_cascades_messages_and_feedback_only(self):
        self.db.execute("DELETE FROM conversations WHERE id=? AND user_id=?", ("alice-conversation", "alice"))
        for table in ("conversations", "messages", "answer_feedback"):
            self.assertEqual(self.count(table, "alice"), 0, table)
            self.assertEqual(self.count(table, "bob"), 1, table)
        self.assertEqual(self.count("user_memories", "alice"), 1)
        self.assertEqual(self.count("public_api_keys", "alice"), 1)

    def test_cross_user_conversation_delete_does_not_delete_other_user(self):
        self.db.execute("DELETE FROM conversations WHERE id=? AND user_id=?", ("bob-conversation", "alice"))
        for table in ("conversations", "messages", "answer_feedback"):
            self.assertEqual(self.count(table, "bob"), 1, table)

    def test_user_delete_cascades_owned_records(self):
        self.db.execute("DELETE FROM users WHERE id=?", ("alice",))
        for table in ("conversations", "messages", "answer_feedback", "user_memories", "public_api_keys"):
            self.assertEqual(self.count(table, "alice"), 0, table)
            self.assertEqual(self.count(table, "bob"), 1, table)

    def test_foreign_keys_are_required_for_cascade(self):
        self.assertEqual(self.db.execute("PRAGMA foreign_keys").fetchone()[0], 1)


if __name__ == "__main__":
    unittest.main()
