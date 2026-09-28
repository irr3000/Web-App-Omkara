-- Existing delivery deadlines and the independent deletion queue stay intact.
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS delete_after_seconds integer;
ALTER TABLE post_deliveries ADD COLUMN IF NOT EXISTS delete_after_seconds integer;
ALTER TABLE post_deliveries ADD COLUMN IF NOT EXISTS send_started_at timestamptz;
UPDATE scheduled_posts
 SET delete_after_seconds=CEIL(EXTRACT(EPOCH FROM (expires_at-publish_at)))::integer,
     expires_at=NULL
 WHERE expires_at IS NOT NULL;
