ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS last_result jsonb NOT NULL DEFAULT '[]';
ALTER TABLE scheduled_posts ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;
CREATE TABLE IF NOT EXISTS scheduler_deletions (
 id bigserial PRIMARY KEY, source_delivery_id bigint UNIQUE NOT NULL,
 chat_id text NOT NULL, message_id bigint NOT NULL, delete_at timestamptz NOT NULL,
 available_at timestamptz NOT NULL DEFAULT now(), error text
);
CREATE INDEX IF NOT EXISTS scheduler_deletions_due ON scheduler_deletions(delete_at,available_at);
CREATE TABLE IF NOT EXISTS scheduler_chats (
 id text PRIMARY KEY, label text NOT NULL, active boolean NOT NULL,
 update_id bigint NOT NULL
);
-- Preserve only the latest successful result for rows sent by the previous version.
UPDATE scheduled_posts p SET last_result=x.result,last_sent_at=x.occurrence
FROM (
 SELECT d.post_id,d.occurrence,jsonb_agg(jsonb_build_object('chat_id',d.chat_id,'state',d.state,'error',d.error) ORDER BY d.id) AS result
 FROM post_deliveries d
 JOIN (SELECT post_id,max(occurrence) occurrence FROM post_deliveries WHERE state='sent' GROUP BY post_id) m ON m.post_id=d.post_id AND m.occurrence=d.occurrence
 GROUP BY d.post_id,d.occurrence HAVING bool_and(d.state='sent')
) x WHERE p.id=x.post_id AND p.last_result='[]'::jsonb;
