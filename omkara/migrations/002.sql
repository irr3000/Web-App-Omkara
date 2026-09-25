-- Additive, idempotent migration. Existing Telegram identity tables are in 001.sql.
CREATE TABLE IF NOT EXISTS scheduled_posts (
 id uuid PRIMARY KEY, text text NOT NULL CHECK(length(text) BETWEEN 1 AND 4096),
 publish_at timestamptz NOT NULL, repeat text NOT NULL CHECK(repeat IN ('once','daily','weekly')),
 channels jsonb NOT NULL, buttons jsonb NOT NULL DEFAULT '[]', expires_at timestamptz,
 enabled boolean NOT NULL DEFAULT true, status text NOT NULL DEFAULT 'pending',
 created_by uuid REFERENCES people(id), created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(), CHECK(expires_at IS NULL OR expires_at>publish_at)
);
CREATE INDEX IF NOT EXISTS scheduled_posts_due ON scheduled_posts(publish_at) WHERE enabled;
CREATE TABLE IF NOT EXISTS post_photos (
 post_id uuid PRIMARY KEY REFERENCES scheduled_posts(id) ON DELETE CASCADE,
 mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png')),
 content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 8388608)
);
-- Persist each destination independently; never resend already acknowledged deliveries.
CREATE TABLE IF NOT EXISTS post_deliveries (
 id bigserial PRIMARY KEY, post_id uuid NOT NULL REFERENCES scheduled_posts(id),
 occurrence timestamptz NOT NULL, chat_id text NOT NULL,
 state text NOT NULL DEFAULT 'pending', message_id bigint, attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), error text,
 delete_at timestamptz, deleted boolean NOT NULL DEFAULT false,
 UNIQUE(post_id,occurrence,chat_id)
);
