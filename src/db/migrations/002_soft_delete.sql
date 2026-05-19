-- Migration 002: Soft delete for expenses
-- Run: node server/src/db/migrate.js  (or apply manually)

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

-- Index for fast filtering of non-deleted expenses
CREATE INDEX IF NOT EXISTS idx_expenses_deleted ON expenses(deleted_at);
