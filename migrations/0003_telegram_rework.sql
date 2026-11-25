-- Migration 0003: Replace the email-based player/RSVP model with Telegram.
--
-- `players.email` and `signups.token` both carry UNIQUE constraints, which
-- SQLite's `ALTER TABLE ... DROP COLUMN` refuses to touch directly, so this
-- uses the standard rebuild pattern (new table, copy, drop, rename) instead.
-- The project hasn't really launched yet, so the one smoke-test row is an
-- acceptable loss here.

-- players: email -> telegram identity, active (bool) -> status (enum)
CREATE TABLE players_new (
  id TEXT PRIMARY KEY,
  telegram_chat_id TEXT NOT NULL UNIQUE,
  telegram_username TEXT,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'paused')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

DROP TABLE players;
ALTER TABLE players_new RENAME TO players;

-- signups: drop the signed token (ownership is now proven by Telegram's own
-- chat_id on the callback_query, not a bearer token in a URL). Not carrying
-- old rows forward either: they reference player_id values from the players
-- table just wiped above, so copying them would violate the FK constraint
-- for no benefit (there's no real data yet, only smoke-test junk).
CREATE TABLE signups_new (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled')),
  responded_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  invited_at TEXT
);

DROP TABLE signups;
ALTER TABLE signups_new RENAME TO signups;

CREATE UNIQUE INDEX IF NOT EXISTS idx_signups_event_player ON signups (event_id, player_id);
