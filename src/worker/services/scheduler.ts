import type { D1Database } from '@cloudflare/workers-types';
import type { BadmintonEvent, ScheduleConfig } from '../../shared/types';
import type { Env } from '../types';
import {
  createEvent,
  ensureSignupsForEvent,
  getRecurringEventByDate,
  getScheduleConfig,
  listEvents,
  listSignupsForEvent,
  lockExpiredEvents,
  markEventInvitesSent,
  markEventReminderSent,
  markSignupSendErrors,
  markSignupsInvited,
} from '../db/queries';
import {
  createTelegramClient,
  inviteButtons,
  renderEventUpdateMessage,
  renderInviteMessage,
  type TelegramClient,
} from './telegram';
import { addDaysToYmd, formatYmd, getZonedParts, zonedDateTimeToUtc } from './timezone';

export interface WeeklyOccurrenceWindow {
  occurrenceDate: string;
  startsAt: Date;
  endsAt: Date;
  deadlineAt: Date;
  inviteAt: Date;
}

/**
 * Given a reference timestamp `now` and `config`, finds the upcoming weekly play date
 * (or today's play date if `now` is before `endsAt`) and its corresponding invite send time.
 */
export function computeWeeklyOccurrence(config: ScheduleConfig, now: Date): WeeklyOccurrenceWindow {
  const localNow = getZonedParts(now, config.timezone);
  const todayYmd = formatYmd(localNow.year, localNow.month, localNow.day);

  let daysUntilPlay = (config.play_weekday - localNow.weekday + 7) % 7;
  let occurrenceDate = addDaysToYmd(todayYmd, daysUntilPlay);

  let startsAt = zonedDateTimeToUtc(occurrenceDate, config.play_start_time, config.timezone);
  let endsAt = zonedDateTimeToUtc(occurrenceDate, config.play_end_time, config.timezone);
  if (endsAt <= startsAt) {
    endsAt = new Date(endsAt.getTime() + 24 * 60 * 60 * 1000);
  }

  // If today is play day and session already ended, advance to next week
  if (daysUntilPlay === 0 && now >= endsAt) {
    occurrenceDate = addDaysToYmd(todayYmd, 7);
    startsAt = zonedDateTimeToUtc(occurrenceDate, config.play_start_time, config.timezone);
    endsAt = zonedDateTimeToUtc(occurrenceDate, config.play_end_time, config.timezone);
    if (endsAt <= startsAt) {
      endsAt = new Date(endsAt.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  const deadlineAt = new Date(startsAt.getTime() - config.deadline_hours_before * 60 * 60 * 1000);

  // Invite weekday is on or before play weekday (0..6 days before play_weekday)
  const daysBeforePlayForInvite = (config.play_weekday - config.invite_weekday + 7) % 7;
  const inviteDate = addDaysToYmd(occurrenceDate, -daysBeforePlayForInvite);
  const inviteAt = zonedDateTimeToUtc(inviteDate, config.invite_time, config.timezone);

  return { occurrenceDate, startsAt, endsAt, deadlineAt, inviteAt };
}

/**
 * `mode` controls who gets messaged:
 * - 'new': only signups never invited before (fresh invite send; lets a
 *   player added after the first send still get exactly one invite later).
 * - 'pending': only signups awaiting a response (reminders, "remind pending").
 * - 'all': every signup (manual "resend to everyone").
 */
export async function dispatchEventInvites(
  db: D1Database,
  env: Env,
  event: BadmintonEvent,
  options: { mode?: 'new' | 'pending' | 'all'; isReminder?: boolean; client?: TelegramClient } = {},
): Promise<{ sent: number; failed: number }> {
  if (event.status !== 'open') {
    return { sent: 0, failed: 0 };
  }

  await ensureSignupsForEvent(db, event.id);
  const signups = await listSignupsForEvent(db, event.id);
  const mode = options.mode ?? 'new';
  const targets = signups.filter((s) => {
    if (mode === 'pending') return s.status === 'pending';
    if (mode === 'new') return s.invited_at === null;
    return true;
  });

  if (targets.length === 0) {
    return { sent: 0, failed: 0 };
  }

  // Telegram has no batch-send endpoint, but at this roster size (a handful
  // of friends, well under its ~30 msg/sec limit) sequential sends are a
  // non-issue — no chunking/backoff needed like the old email batching did.
  const bot = options.client ?? createTelegramClient(env);
  let sent = 0;
  let failed = 0;
  const succeededIds: string[] = [];
  const failures: Array<{ signupId: string; error: string }> = [];

  for (const row of targets) {
    try {
      const text = renderInviteMessage({ event, playerName: row.player_name, isReminder: options.isReminder });
      await bot.sendMessage(row.telegram_chat_id, text, inviteButtons(row.signup_id));
      sent++;
      succeededIds.push(row.signup_id);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : 'Unknown error';
      failures.push({ signupId: row.signup_id, error: message });
      console.error(`Failed sending Telegram message to chat ${row.telegram_chat_id}:`, err);
    }
  }

  const nowIso = new Date().toISOString();
  await markSignupsInvited(db, succeededIds, nowIso);
  await markSignupSendErrors(db, failures, nowIso);
  if (options.isReminder) {
    await markEventReminderSent(db, event.id, nowIso);
  } else {
    await markEventInvitesSent(db, event.id, nowIso);
  }

  return { sent, failed };
}

/**
 * Tells players who still have a stake in this event (pending or already
 * accepted — not cancelled, they've opted out already) that something
 * meaningful changed, with fresh Accept/Cancel buttons since a time/venue
 * change is exactly when someone might reconsider. Unlike dispatchEventInvites,
 * this doesn't touch invited_at/last_send_error — those track the original
 * invite's lifecycle, not this separate notification.
 */
export async function notifyEventUpdated(
  db: D1Database,
  env: Env,
  event: BadmintonEvent,
  changedLines: string[],
  client?: TelegramClient,
): Promise<{ sent: number; failed: number }> {
  if (changedLines.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const signups = await listSignupsForEvent(db, event.id);
  const targets = signups.filter((s) => s.status === 'pending' || s.status === 'accepted');
  if (targets.length === 0) {
    return { sent: 0, failed: 0 };
  }

  const bot = client ?? createTelegramClient(env);
  let sent = 0;
  let failed = 0;

  for (const row of targets) {
    try {
      const text = renderEventUpdateMessage({ event, playerName: row.player_name, changedLines });
      await bot.sendMessage(row.telegram_chat_id, text, inviteButtons(row.signup_id));
      sent++;
    } catch (err) {
      failed++;
      console.error(`Failed sending update notification to chat ${row.telegram_chat_id}:`, err);
    }
  }

  return { sent, failed };
}

export async function runScheduledTick(
  db: D1Database,
  env: Env,
  now: Date = new Date(),
): Promise<{ locked: number; createdRecurring: boolean; invitesSent: number; remindersSent: number }> {
  const nowIso = now.toISOString();
  const locked = await lockExpiredEvents(db, nowIso);

  const config = await getScheduleConfig(db);
  let createdRecurring = false;
  let invitesSent = 0;
  let remindersSent = 0;

  if (config.active) {
    const window = computeWeeklyOccurrence(config, now);
    if (now >= window.inviteAt && now < window.deadlineAt) {
      let event = await getRecurringEventByDate(db, window.occurrenceDate);
      if (!event) {
        event = await createEvent(db, {
          title: config.title_template || 'Weekly Badminton',
          event_type: 'recurring',
          occurrence_date: window.occurrenceDate,
          starts_at: window.startsAt.toISOString(),
          ends_at: window.endsAt.toISOString(),
          deadline_at: window.deadlineAt.toISOString(),
          timezone: config.timezone,
          venue: config.venue,
          max_players: config.max_players,
        });
        createdRecurring = true;
      }

      // Always dispatch in 'new' mode (not just on the first tick): this is a
      // no-op once everyone active has been invited, but still catches a
      // player who joins the roster after the first send.
      if (event.status === 'open') {
        const result = await dispatchEventInvites(db, env, event, { mode: 'new' });
        invitesSent += result.sent;
      }
    }
  }

  if (config.reminder_hours_before_deadline > 0) {
    const allEvents = await listEvents(db);
    for (const ev of allEvents) {
      if (ev.status !== 'open') continue;
      if (!ev.invites_sent_at || ev.reminder_sent_at) continue;

      const deadlineMs = new Date(ev.deadline_at).getTime();
      const reminderAtMs = deadlineMs - config.reminder_hours_before_deadline * 60 * 60 * 1000;
      if (now.getTime() >= reminderAtMs && now.getTime() < deadlineMs) {
        const res = await dispatchEventInvites(db, env, ev, {
          mode: 'pending',
          isReminder: true,
        });
        remindersSent += res.sent;
      }
    }
  }

  return { locked, createdRecurring, invitesSent, remindersSent };
}
