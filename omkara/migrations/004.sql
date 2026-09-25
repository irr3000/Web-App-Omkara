-- Telegram-only identities have no web credentials. Linking requires proof of both accounts.
ALTER TABLE people ALTER COLUMN email DROP NOT NULL;
ALTER TABLE people ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE people ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE people ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES people(id);
CREATE TABLE IF NOT EXISTS telegram_dialogs (
 telegram_id text PRIMARY KEY,
 state jsonb NOT NULL DEFAULT '{}',
 expires_at timestamptz NOT NULL DEFAULT now()
);
-- Committing the reply with domain changes prevents mutations from replaying on send failure.
ALTER TABLE telegram_updates ADD COLUMN IF NOT EXISTS reply jsonb;
ALTER TABLE telegram_updates ADD COLUMN IF NOT EXISTS handled boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS telegram_updates_pending ON telegram_updates(update_id) WHERE processed=false;
CREATE TABLE IF NOT EXISTS telegram_notifications (
 id bigserial PRIMARY KEY, chat_id text NOT NULL,
 registration_id uuid REFERENCES registrations(id), text text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent','failed')),
 attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_notifications_pending ON telegram_notifications(available_at,id) WHERE state='pending';
