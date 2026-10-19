CREATE TABLE ticket_types (
  id TEXT PRIMARY KEY,
  stock INTEGER,
  sold INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT stock_available CHECK (stock IS NULL OR sold <= stock)
);
CREATE TABLE buyer_purchases (
  email_hash TEXT NOT NULL,
  ticket_type_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  max_quantity INTEGER,
  PRIMARY KEY (email_hash, ticket_type_id),
  CONSTRAINT per_person_limit CHECK (max_quantity IS NULL OR quantity <= max_quantity)
);
CREATE TABLE orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
CREATE TABLE staff_invites (email TEXT PRIMARY KEY, role TEXT NOT NULL, name TEXT NOT NULL DEFAULT '');
