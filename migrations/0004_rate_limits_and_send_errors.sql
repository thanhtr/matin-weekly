-- Migration 0004: shared rate-limit counter table (used for both admin login
-- throttling and per-chat Telegram webhook throttling), plus per-signup
-- send-failure tracking so a failed Telegram send is visible in the
-- dashboard instead of only the Worker's console logs.

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TEXT NOT NULL
);

ALTER TABLE signups ADD COLUMN last_send_error TEXT;
ALTER TABLE signups ADD COLUMN last_send_error_at TEXT;
