import type { D1Database } from '@cloudflare/workers-types';
import type {
  BadmintonEvent,
  EventSignupRow,
  EventStatus,
  EventType,
  Player,
  PlayerStatus,
  ScheduleConfig,
  SignupStatus,
} from '../../shared/types';

interface RawScheduleRow {
  id: number;
  active: number;
  title_template: string;
  play_weekday: number;
  play_start_time: string;
  play_end_time: string;
  venue: string;
  timezone: string;
  invite_weekday: number;
  invite_time: string;
  deadline_hours_before: number;
  reminder_hours_before_deadline: number;
  max_players: number | null;
  updated_at: string;
}

function mapSchedule(row: RawScheduleRow): ScheduleConfig {
  return {
    ...row,
    active: row.active === 1,
  };
}

export async function getScheduleConfig(db: D1Database): Promise<ScheduleConfig> {
  const row = await db.prepare('SELECT * FROM schedule_config WHERE id = 1').first<RawScheduleRow>();
  if (!row) {
    await db.prepare('INSERT OR IGNORE INTO schedule_config (id) VALUES (1)').run();
    const created = await db.prepare('SELECT * FROM schedule_config WHERE id = 1').first<RawScheduleRow>();
    if (!created) throw new Error('Failed to initialize schedule_config');
    return mapSchedule(created);
  }
  return mapSchedule(row);
}

export async function updateScheduleConfig(
  db: D1Database,
  patch: Partial<Omit<ScheduleConfig, 'id' | 'updated_at'>>,
): Promise<ScheduleConfig> {
  const current = await getScheduleConfig(db);
  const next: ScheduleConfig = {
    ...current,
    ...patch,
    id: 1,
    updated_at: new Date().toISOString(),
  };

  await db
    .prepare(
      `UPDATE schedule_config SET
        active = ?,
        title_template = ?,
        play_weekday = ?,
        play_start_time = ?,
        play_end_time = ?,
        venue = ?,
        timezone = ?,
        invite_weekday = ?,
        invite_time = ?,
        deadline_hours_before = ?,
        reminder_hours_before_deadline = ?,
        max_players = ?,
        updated_at = ?
      WHERE id = 1`,
    )
    .bind(
      next.active ? 1 : 0,
      next.title_template,
      next.play_weekday,
      next.play_start_time,
      next.play_end_time,
      next.venue,
      next.timezone,
      next.invite_weekday,
      next.invite_time,
      next.deadline_hours_before,
      next.reminder_hours_before_deadline,
      next.max_players,
      next.updated_at,
    )
    .run();

  return next;
}

export async function listPlayers(db: D1Database): Promise<Player[]> {
  const res = await db
    .prepare(
      `SELECT * FROM players
       ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END, name ASC`,
    )
    .all<Player>();
  return res.results;
}

export async function listActivePlayers(db: D1Database): Promise<Player[]> {
  const res = await db.prepare("SELECT * FROM players WHERE status = 'active' ORDER BY name ASC").all<Player>();
  return res.results;
}

export async function countPendingPlayers(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS cnt FROM players WHERE status = 'pending'").first<{ cnt: number }>();
  return Number(row?.cnt ?? 0);
}

export async function getPlayerByChatId(db: D1Database, chatId: string): Promise<Player | null> {
  return await db.prepare('SELECT * FROM players WHERE telegram_chat_id = ?').bind(chatId).first<Player>();
}

/**
 * Called when someone sends /start to the bot. A brand-new chat id is
 * inserted as 'pending' (requires admin approval before it can receive
 * invites); an existing player's status is left untouched — only their
 * display name/username are refreshed — so re-starting the bot never
 * silently reactivates someone the admin paused or hasn't approved yet.
 */
export async function upsertPlayerFromTelegram(
  db: D1Database,
  params: { chatId: string; username: string | null; name: string },
): Promise<Player> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO players (id, telegram_chat_id, telegram_username, name, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)
       ON CONFLICT(telegram_chat_id) DO UPDATE SET
         telegram_username = excluded.telegram_username,
         name = CASE WHEN excluded.name != '' THEN excluded.name ELSE players.name END`,
    )
    .bind(crypto.randomUUID(), params.chatId, params.username, params.name, now)
    .run();

  const player = await getPlayerByChatId(db, params.chatId);
  if (!player) throw new Error('Failed to upsert player');
  return player;
}

export async function setPlayerStatus(db: D1Database, id: string, status: PlayerStatus): Promise<void> {
  await db.prepare('UPDATE players SET status = ? WHERE id = ?').bind(status, id).run();
}

export async function deletePlayer(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM players WHERE id = ?').bind(id).run();
}

export async function listEvents(db: D1Database): Promise<Array<BadmintonEvent & { accepted_count: number; pending_count: number; cancelled_count: number }>> {
  const res = await db
    .prepare(
      `SELECT e.*,
        SUM(CASE WHEN s.status = 'accepted' THEN 1 ELSE 0 END) AS accepted_count,
        SUM(CASE WHEN s.status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN s.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
      FROM events e
      LEFT JOIN signups s ON s.event_id = e.id
      GROUP BY e.id
      ORDER BY e.starts_at DESC`,
    )
    .all<BadmintonEvent & { accepted_count: number | null; pending_count: number | null; cancelled_count: number | null }>();

  return res.results.map((r) => ({
    ...r,
    accepted_count: Number(r.accepted_count ?? 0),
    pending_count: Number(r.pending_count ?? 0),
    cancelled_count: Number(r.cancelled_count ?? 0),
  }));
}

export async function getEventById(db: D1Database, id: string): Promise<BadmintonEvent | null> {
  return await db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<BadmintonEvent>();
}

export async function getRecurringEventByDate(db: D1Database, occurrenceDate: string): Promise<BadmintonEvent | null> {
  return await db
    .prepare("SELECT * FROM events WHERE event_type = 'recurring' AND occurrence_date = ?")
    .bind(occurrenceDate)
    .first<BadmintonEvent>();
}

export async function createEvent(
  db: D1Database,
  input: {
    title: string;
    event_type: EventType;
    occurrence_date: string;
    starts_at: string;
    ends_at: string;
    deadline_at: string;
    timezone: string;
    venue: string;
    notes?: string;
    max_players?: number | null;
  },
): Promise<BadmintonEvent> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO events (
        id, title, event_type, occurrence_date, starts_at, ends_at, deadline_at,
        timezone, venue, notes, max_players, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`,
    )
    .bind(
      id,
      input.title,
      input.event_type,
      input.occurrence_date,
      input.starts_at,
      input.ends_at,
      input.deadline_at,
      input.timezone,
      input.venue,
      input.notes ?? '',
      input.max_players ?? null,
      now,
    )
    .run();

  const created = await getEventById(db, id);
  if (!created) throw new Error('Failed to create event');
  return created;
}

export async function updateEvent(
  db: D1Database,
  id: string,
  patch: Partial<{
    title: string;
    occurrence_date: string;
    starts_at: string;
    ends_at: string;
    deadline_at: string;
    venue: string;
    notes: string;
    max_players: number | null;
    status: EventStatus;
  }>,
): Promise<BadmintonEvent | null> {
  const current = await getEventById(db, id);
  if (!current) return null;
  const next = { ...current, ...patch };
  await db
    .prepare(
      `UPDATE events SET
        title = ?, occurrence_date = ?, starts_at = ?, ends_at = ?, deadline_at = ?,
        venue = ?, notes = ?, max_players = ?, status = ?
      WHERE id = ?`,
    )
    .bind(
      next.title,
      next.occurrence_date,
      next.starts_at,
      next.ends_at,
      next.deadline_at,
      next.venue,
      next.notes,
      next.max_players,
      next.status,
      id,
    )
    .run();
  return getEventById(db, id);
}

export async function markEventInvitesSent(db: D1Database, id: string, sentAt: string): Promise<void> {
  await db.prepare('UPDATE events SET invites_sent_at = COALESCE(invites_sent_at, ?) WHERE id = ?').bind(sentAt, id).run();
}

export async function markSignupsInvited(db: D1Database, signupIds: string[], sentAt: string): Promise<void> {
  if (signupIds.length === 0) return;
  const statements = signupIds.map((id) =>
    db.prepare('UPDATE signups SET invited_at = COALESCE(invited_at, ?) WHERE id = ?').bind(sentAt, id),
  );
  await db.batch(statements);
}

export async function markEventReminderSent(db: D1Database, id: string, sentAt: string): Promise<void> {
  await db.prepare('UPDATE events SET reminder_sent_at = COALESCE(reminder_sent_at, ?) WHERE id = ?').bind(sentAt, id).run();
}

export async function lockExpiredEvents(db: D1Database, nowIso: string): Promise<number> {
  const res = await db
    .prepare("UPDATE events SET status = 'locked' WHERE status = 'open' AND deadline_at <= ?")
    .bind(nowIso)
    .run();
  return res.meta.changes ?? 0;
}

export async function ensureSignupsForEvent(db: D1Database, eventId: string): Promise<void> {
  const activePlayers = await listActivePlayers(db);
  const existingRows = await db
    .prepare('SELECT player_id FROM signups WHERE event_id = ?')
    .bind(eventId)
    .all<{ player_id: string }>();
  const existingSet = new Set(existingRows.results.map((r) => r.player_id));
  const now = new Date().toISOString();

  const statements = activePlayers
    .filter((player) => !existingSet.has(player.id))
    .map((player) =>
      db
        .prepare(
          `INSERT INTO signups (id, event_id, player_id, status, updated_at)
           VALUES (?, ?, ?, 'pending', ?)`,
        )
        .bind(crypto.randomUUID(), eventId, player.id, now),
    );

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

export async function listSignupsForEvent(db: D1Database, eventId: string): Promise<EventSignupRow[]> {
  const res = await db
    .prepare(
      `SELECT
        s.id AS signup_id,
        p.id AS player_id,
        p.name AS player_name,
        p.telegram_chat_id AS telegram_chat_id,
        p.telegram_username AS telegram_username,
        s.status AS status,
        s.responded_at AS responded_at,
        s.updated_at AS updated_at,
        s.invited_at AS invited_at
      FROM signups s
      JOIN players p ON p.id = s.player_id
      WHERE s.event_id = ?
      ORDER BY
        CASE s.status WHEN 'accepted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        s.responded_at ASC,
        p.name ASC`,
    )
    .bind(eventId)
    .all<EventSignupRow>();
  return res.results;
}

export async function getSignupById(
  db: D1Database,
  signupId: string,
): Promise<{
  signup_id: string;
  event_id: string;
  player_id: string;
  telegram_chat_id: string;
  player_name: string;
  status: SignupStatus;
  responded_at: string | null;
  event: BadmintonEvent;
} | null> {
  const row = await db
    .prepare(
      `SELECT
        s.id AS signup_id,
        s.event_id AS event_id,
        s.player_id AS player_id,
        s.status AS status,
        s.responded_at AS responded_at,
        p.telegram_chat_id AS telegram_chat_id,
        p.name AS player_name,
        e.id AS e_id,
        e.title AS e_title,
        e.event_type AS e_event_type,
        e.occurrence_date AS e_occurrence_date,
        e.starts_at AS e_starts_at,
        e.ends_at AS e_ends_at,
        e.deadline_at AS e_deadline_at,
        e.timezone AS e_timezone,
        e.venue AS e_venue,
        e.notes AS e_notes,
        e.max_players AS e_max_players,
        e.status AS e_status,
        e.invites_sent_at AS e_invites_sent_at,
        e.reminder_sent_at AS e_reminder_sent_at,
        e.created_at AS e_created_at
      FROM signups s
      JOIN players p ON p.id = s.player_id
      JOIN events e ON e.id = s.event_id
      WHERE s.id = ?`,
    )
    .bind(signupId)
    .first<Record<string, unknown>>();

  if (!row) return null;

  return {
    signup_id: String(row.signup_id),
    event_id: String(row.event_id),
    player_id: String(row.player_id),
    telegram_chat_id: String(row.telegram_chat_id),
    player_name: String(row.player_name),
    status: row.status as SignupStatus,
    responded_at: (row.responded_at as string | null) ?? null,
    event: {
      id: String(row.e_id),
      title: String(row.e_title),
      event_type: row.e_event_type as EventType,
      occurrence_date: String(row.e_occurrence_date),
      starts_at: String(row.e_starts_at),
      ends_at: String(row.e_ends_at),
      deadline_at: String(row.e_deadline_at),
      timezone: String(row.e_timezone),
      venue: String(row.e_venue),
      notes: String(row.e_notes),
      max_players: row.e_max_players === null ? null : Number(row.e_max_players),
      status: row.e_status as EventStatus,
      invites_sent_at: (row.e_invites_sent_at as string | null) ?? null,
      reminder_sent_at: (row.e_reminder_sent_at as string | null) ?? null,
      created_at: String(row.e_created_at),
    },
  };
}

export async function countAcceptedSignups(db: D1Database, eventId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS cnt FROM signups WHERE event_id = ? AND status = 'accepted'")
    .bind(eventId)
    .first<{ cnt: number }>();
  return Number(row?.cnt ?? 0);
}

export async function setSignupStatus(
  db: D1Database,
  signupId: string,
  status: SignupStatus,
  nowIso: string,
): Promise<void> {
  const respondedAt = status === 'pending' ? null : nowIso;
  await db
    .prepare('UPDATE signups SET status = ?, responded_at = ?, updated_at = ? WHERE id = ?')
    .bind(status, respondedAt, nowIso, signupId)
    .run();
}

/**
 * Atomically applies a player's RSVP: the UPDATE itself enforces that the event
 * is open, before its deadline, and (for 'accepted') under capacity, so a race
 * between two players accepting the last slot can't both succeed.
 * Returns true if the row was updated.
 */
export async function setSignupStatusIfOpen(
  db: D1Database,
  signupId: string,
  status: SignupStatus,
  nowIso: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE signups
       SET status = ?, responded_at = ?, updated_at = ?
       WHERE id = ?
         AND EXISTS (
           SELECT 1 FROM events e
           WHERE e.id = signups.event_id
             AND e.status = 'open'
             AND e.deadline_at > ?
             AND (
               ? != 'accepted'
               OR e.max_players IS NULL
               OR (
                 SELECT COUNT(*) FROM signups s2
                 WHERE s2.event_id = e.id AND s2.status = 'accepted' AND s2.id != signups.id
               ) < e.max_players
             )
         )`,
    )
    .bind(status, status === 'pending' ? null : nowIso, nowIso, signupId, nowIso, status)
    .run();
  return (res.meta.changes ?? 0) > 0;
}
