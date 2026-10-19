-- Ticket data (replaces the Firestore collections; see DEPLOY.md).
-- Times are epoch milliseconds.

-- One row per ticket type. `config` is the type as the management page edits
-- it (name, price, sale window, limits...); `stock` and `sold` are kept as
-- columns so the CHECK makes overselling impossible: a checkout batch that
-- would push `sold` past `stock` fails as a whole.
CREATE TABLE ticket_types (
  id TEXT PRIMARY KEY,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,          -- 0: removed from the list but has sales
  config TEXT NOT NULL,                       -- JSON
  stock INTEGER,                              -- NULL: unlimited
  sold INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  updated_by_uid TEXT,
  CONSTRAINT stock_available CHECK (stock IS NULL OR sold <= stock),
  CONSTRAINT sold_not_negative CHECK (sold >= 0)
);

-- Tickets bought per account email (sha256), against the type's per-person
-- limit at the time of the checkout
CREATE TABLE buyer_purchases (
  email_hash TEXT NOT NULL,
  ticket_type_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  max_quantity INTEGER,                       -- NULL: no limit
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (email_hash, ticket_type_id),
  CONSTRAINT per_person_limit CHECK (max_quantity IS NULL OR quantity <= max_quantity)
) WITHOUT ROWID;

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  school TEXT NOT NULL,
  class TEXT NOT NULL DEFAULT '',
  number TEXT NOT NULL DEFAULT '',
  office TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL,                        -- JSON [{ id, ticketTypeId, name, price, quantity }]
  original_total INTEGER NOT NULL,
  final_total INTEGER NOT NULL,
  ticket_code TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  delivery_updated_at INTEGER,
  delivery_updated_by_uid TEXT,
  delivery_updated_by_name TEXT,
  paid INTEGER NOT NULL DEFAULT 0,
  payment_updated_at INTEGER,
  payment_updated_by_uid TEXT,
  payment_updated_by_name TEXT,
  email_status TEXT NOT NULL DEFAULT 'pending',
  email_job_id TEXT,
  email_error TEXT,
  email_updated_at INTEGER,
  email_provider_message_id TEXT,
  created_at INTEGER NOT NULL,
  -- Deleting an order keeps the row (and its history) and gives the tickets
  -- back once: the stock release in the same batch only matches this token.
  deleted_at INTEGER,
  delete_token TEXT
);
CREATE INDEX orders_by_user ON orders (user_id, created_at);
CREATE INDEX orders_by_time ON orders (deleted_at, created_at DESC, id DESC);
CREATE INDEX orders_by_school ON orders (school, created_at DESC);

-- Tickets per order and type, for the stock release and statistics
CREATE TABLE order_items (
  order_id TEXT NOT NULL,
  ticket_type_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  PRIMARY KEY (order_id, ticket_type_id)
) WITHOUT ROWID;

-- Audit trail of check-ins and payments, written with the status change
CREATE TABLE order_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  action TEXT NOT NULL,                       -- delivery | payment
  previous_value INTEGER NOT NULL,
  value INTEGER NOT NULL,
  actor_uid TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  code_verification TEXT,
  override_reason TEXT
);
CREATE INDEX order_history_by_order ON order_history (order_id, occurred_at);

-- Checkout recovery: a retried checkout with the same request id returns the
-- order it created, or the definite rejection it got
CREATE TABLE order_requests (
  request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  order_id TEXT,
  status TEXT NOT NULL,                       -- created | rejected
  error_code TEXT,
  error_message TEXT,
  created_at INTEGER NOT NULL
);

-- A passed Turnstile check covers retries of the same checkout for 10 minutes
CREATE TABLE turnstile_passes (
  request_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Site settings, e.g. shop = { openAt }
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                        -- JSON
  updated_at INTEGER NOT NULL,
  updated_by_uid TEXT
);

-- Staff invites, by lower-case email; consumed on the invitee's first sign-in
CREATE TABLE staff_invites (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('manager', 'admin', 'super_admin')),
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- Every email the site sends. pending/retry -> sending -> accepted, failed,
-- uncertain or skipped. A send whose outcome is unknown becomes uncertain and
-- is never sent again automatically.
CREATE TABLE mail_jobs (
  id TEXT PRIMARY KEY,                        -- confirmation_{orderId}, resend_..., notification_{job}_{start}
  kind TEXT NOT NULL,                         -- confirmation | notification
  purpose TEXT,
  order_id TEXT,
  notification_job_id TEXT,
  type TEXT,
  subject TEXT,
  fields TEXT,                                -- JSON
  recipients TEXT,                            -- JSON
  recipient_count INTEGER NOT NULL,
  buyer_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at INTEGER,
  lease_until INTEGER,
  send_started_at INTEGER,
  provider_message_id TEXT,
  accepted_at INTEGER,
  error TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX mail_jobs_available ON mail_jobs (status, available_at);
CREATE INDEX mail_jobs_by_notification ON mail_jobs (notification_job_id);

-- Shared pacing of every mail source (one row, id = 'global')
CREATE TABLE mail_control (
  id TEXT PRIMARY KEY,
  next_send_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO mail_control (id, next_send_at) VALUES ('global', 0);

CREATE TABLE notification_jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  school TEXT NOT NULL,
  subject TEXT NOT NULL,
  fields TEXT NOT NULL,                       -- JSON
  total INTEGER NOT NULL,
  batch_count INTEGER NOT NULL,
  status TEXT NOT NULL,
  queued_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Recipients frozen when the notification is prepared, MAX_BCC_PER_BATCH each
CREATE TABLE notification_batches (
  job_id TEXT NOT NULL,
  start INTEGER NOT NULL,
  recipients TEXT NOT NULL,                   -- JSON
  PRIMARY KEY (job_id, start)
) WITHOUT ROWID;

CREATE TABLE party_stories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  publish_at INTEGER NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  updated_by_uid TEXT
);

CREATE TABLE party_lineup (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  publish_at INTEGER NOT NULL,
  image_key TEXT,                             -- R2 key under lineup/
  created_at INTEGER NOT NULL,
  created_by_uid TEXT,
  updated_at INTEGER NOT NULL,
  updated_by_uid TEXT
);

CREATE TABLE survey_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identity TEXT NOT NULL,
  channels TEXT NOT NULL,                     -- JSON
  device TEXT NOT NULL,
  scores TEXT NOT NULL,                       -- JSON { q4..q29 }
  issue_count TEXT NOT NULL,
  issue_types TEXT NOT NULL,                  -- JSON
  improvement TEXT NOT NULL,
  suggestion TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
