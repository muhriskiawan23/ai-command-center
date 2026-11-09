-- Keep user-supplied link citation mappings with the assistant message that uses them.
ALTER TABLE messages ADD COLUMN links_json TEXT;
