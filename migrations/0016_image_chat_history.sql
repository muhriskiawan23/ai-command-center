-- Image Assistant chat association, additive and disabled by default.
-- Does not migrate existing images or grant credits. Require independently
-- reviewed production D1 bookmark before enabling or applying remotely.
ALTER TABLE image_jobs ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL;
CREATE INDEX image_jobs_by_conversation ON image_jobs(user_id,conversation_id,created_at DESC);
