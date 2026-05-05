-- Roomie Split Database Schema
-- Run: psql $DATABASE_URL -f server/src/db/migrations/001_init.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS rooms (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name         VARCHAR(100) NOT NULL,
  invite_code  VARCHAR(8) UNIQUE NOT NULL,
  rent_amount  INTEGER NOT NULL DEFAULT 450000,  -- stored in paise
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id          UUID REFERENCES rooms(id) ON DELETE CASCADE,
  name             VARCHAR(100) NOT NULL,
  upi_id           VARCHAR(100) NOT NULL,
  qr_code_base64   TEXT,
  color            VARCHAR(7) NOT NULL DEFAULT '#6366f1',
  avatar_initials  VARCHAR(3) NOT NULL,
  fcm_token        TEXT,
  push_subscription JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id       UUID REFERENCES rooms(id) ON DELETE CASCADE,
  payer_id      UUID REFERENCES members(id),
  purpose       VARCHAR(200) NOT NULL,
  total_amount  INTEGER NOT NULL,  -- stored in paise
  date          DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS splits (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id    UUID REFERENCES expenses(id) ON DELETE CASCADE,
  member_id     UUID REFERENCES members(id),
  share         INTEGER NOT NULL,          -- paise
  paid          BOOLEAN NOT NULL DEFAULT FALSE,
  paid_at       TIMESTAMPTZ,
  carry_forward INTEGER NOT NULL DEFAULT 0  -- paise
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_splits_member   ON splits(member_id);
CREATE INDEX IF NOT EXISTS idx_splits_expense  ON splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_expenses_room   ON expenses(room_id);
CREATE INDEX IF NOT EXISTS idx_members_room    ON members(room_id);
CREATE INDEX IF NOT EXISTS idx_splits_paid     ON splits(paid);
