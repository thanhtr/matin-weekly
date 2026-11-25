-- Migration 0002: Track per-signup invite dispatch so late-joining players
-- still get exactly one invite on the next cron tick.

ALTER TABLE signups ADD COLUMN invited_at TEXT;
