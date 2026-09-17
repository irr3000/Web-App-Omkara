CREATE TABLE IF NOT EXISTS people (
 id uuid PRIMARY KEY,
 email text NOT NULL UNIQUE CHECK(email=lower(email)),
 password_hash text NOT NULL,
 first_name text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
 role text NOT NULL DEFAULT 'member' CHECK(role IN ('member','admin')),
 telegram_id text UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash text PRIMARY KEY,
 person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
 csrf text NOT NULL,
 expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS email_tokens (
 token_hash text PRIMARY KEY, email text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('signup','reset')),
 payload jsonb NOT NULL DEFAULT '{}', expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
 id uuid PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('retreat','meeting')),
 title text NOT NULL, description text NOT NULL DEFAULT '',
 starts_at timestamptz, ends_at timestamptz,
 location text NOT NULL DEFAULT '',
 price_kop integer NOT NULL CHECK(price_kop>=0),
 capacity integer CHECK(capacity>0),
 registration_open boolean NOT NULL DEFAULT false,
 published boolean NOT NULL DEFAULT false,
 payment_instructions text NOT NULL DEFAULT '',
 participant_information text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at>=starts_at)
);
CREATE TABLE IF NOT EXISTS registrations (
 id uuid PRIMARY KEY, person_id uuid NOT NULL REFERENCES people(id),
 event_id uuid NOT NULL REFERENCES events(id),
 price_kop integer NOT NULL CHECK(price_kop>=0),
 status text NOT NULL DEFAULT 'awaiting_payment' CHECK(status IN ('awaiting_payment','review','confirmed','completed','cancelled')),
 paid_kop integer NOT NULL DEFAULT 0 CHECK(paid_kop>=0),
 reviewed_by uuid REFERENCES people(id), reviewed_at timestamptz,
 admin_note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS registrations_active ON registrations(person_id,event_id) WHERE status NOT IN ('cancelled','completed');
CREATE INDEX IF NOT EXISTS registrations_event ON registrations(event_id,status);
CREATE TABLE IF NOT EXISTS receipts (
 id uuid PRIMARY KEY, registration_id uuid NOT NULL REFERENCES registrations(id),
 mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','application/pdf')),
 content bytea NOT NULL CHECK(octet_length(content)<=8388608),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS receipt_registration ON receipts(registration_id);
CREATE TABLE IF NOT EXISTS audit (
 id bigserial PRIMARY KEY, actor_id uuid REFERENCES people(id),
 action text NOT NULL, target_id uuid, details jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS rate_limits (
 key text PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_links (
 token_hash text PRIMARY KEY, person_id uuid NOT NULL REFERENCES people(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS telegram_updates (
 update_id bigint PRIMARY KEY, payload jsonb NOT NULL,
 processed boolean NOT NULL DEFAULT false, attempts integer NOT NULL DEFAULT 0,
 available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now()
);
