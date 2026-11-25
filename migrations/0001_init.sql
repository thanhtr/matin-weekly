-- Migration 0001: Initial schema for Matin Weekly Badminton

CREATE TABLE IF NOT EXISTS schedule_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  active INTEGER NOT NULL DEFAULT 0,
  title_template TEXT NOT NULL DEFAULT 'Weekly Badminton',
  play_weekday INTEGER NOT NULL DEFAULT 3,          -- 0=Sun..6=Sat (3=Wednesday)
  play_start_time TEXT NOT NULL DEFAULT '19:00',    -- HH:MM (24h)
  play_end_time TEXT NOT NULL DEFAULT '21:00',      -- HH:MM (24h)
  venue TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'Europe/Helsinki',
  invite_weekday INTEGER NOT NULL DEFAULT 1,        -- 0=Sun..6=Sat (1=Monday)
  invite_time TEXT NOT NULL DEFAULT '09:00',        -- HH:MM (24h)
  deadline_hours_before INTEGER NOT NULL DEFAULT 24,
  reminder_hours_before_deadline INTEGER NOT NULL DEFAULT 6, -- 0 disables reminder
  max_players INTEGER,                              -- NULL = unlimited
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO schedule_config (id) VALUES (1);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('recurring', 'on_demand')),
  occurrence_date TEXT NOT NULL,                    -- YYYY-MM-DD in event timezone
  starts_at TEXT NOT NULL,                          -- ISO 8601 UTC
  ends_at TEXT NOT NULL,                            -- ISO 8601 UTC
  deadline_at TEXT NOT NULL,                        -- ISO 8601 UTC
  timezone TEXT NOT NULL DEFAULT 'Europe/Helsinki',
  venue TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  max_players INTEGER,                              -- NULL = unlimited
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'locked', 'cancelled')),
  invites_sent_at TEXT,
  reminder_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_recurring_date
  ON events (event_type, occurrence_date)
  WHERE event_type = 'recurring';

CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events (starts_at DESC);

CREATE TABLE IF NOT EXISTS signups (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled')),
  responded_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signups_event_player ON signups (event_id, player_id);
CREATE INDEX IF NOT EXISTS idx_signups_token ON signups (token);
