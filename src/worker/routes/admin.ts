import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import {
  clearAdminSessionCookie,
  isAdminAuthenticated,
  requireAdmin,
  setAdminSessionCookie,
  verifyPassword,
} from '../middleware/auth';
import {
  countPendingPlayers,
  createEvent,
  deletePlayer,
  ensureSignupsForEvent,
  getEventById,
  getPlayerById,
  getScheduleConfig,
  listEvents,
  listPlayers,
  listSignupsForEvent,
  setPlayerName,
  setPlayerStatus,
  setSignupStatus,
  updateEvent,
  updateScheduleConfig,
} from '../db/queries';
import { computeWeeklyOccurrence, dispatchEventInvites, notifyEventUpdated, runScheduledTick } from '../services/scheduler';
import { createTelegramClient, diffEventFields } from '../services/telegram';
import { formatLocalTime, formatYmd, getZonedParts, zonedDateTimeToUtc } from '../services/timezone';
import { checkRateLimit, resetRateLimit } from '../services/rateLimit';

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/login', async (c) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const rateLimitKey = `login:${ip}`;
  const allowed = await checkRateLimit(c.env.DB, rateLimitKey, { maxAttempts: 5, windowSeconds: 900 });
  if (!allowed) {
    return c.json({ error: 'Too many login attempts. Try again in a few minutes.' }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ password: z.string().min(1) }).safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Password is required' }, 400);
  }

  if (!verifyPassword(parsed.data.password, c.env.ADMIN_PASSWORD)) {
    return c.json({ error: 'Invalid password' }, 401);
  }

  await resetRateLimit(c.env.DB, rateLimitKey);
  await setAdminSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.post('/logout', (c) => {
  clearAdminSessionCookie(c);
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const authenticated = await isAdminAuthenticated(c);
  return c.json({ authenticated });
});

export const adminRoutes = new Hono<{ Bindings: Env }>();
adminRoutes.use('*', requireAdmin);

const scheduleSchema = z.object({
  active: z.boolean(),
  title_template: z.string().min(1).max(120),
  play_weekday: z.number().int().min(0).max(6),
  play_start_time: z.string().regex(/^\d{2}:\d{2}$/),
  play_end_time: z.string().regex(/^\d{2}:\d{2}$/),
  venue: z.string().max(200),
  timezone: z.string().min(1).max(80),
  invite_weekday: z.number().int().min(0).max(6),
  invite_time: z.string().regex(/^\d{2}:\d{2}$/),
  deadline_hours_before: z.number().int().min(0).max(168),
  reminder_hours_before_deadline: z.number().int().min(0).max(72),
  max_players: z.number().int().min(1).max(200).nullable(),
});

function withSchedulePreview(config: Awaited<ReturnType<typeof getScheduleConfig>>) {
  if (!config.active) {
    return { ...config, preview: null };
  }
  const window = computeWeeklyOccurrence(config, new Date());
  return {
    ...config,
    preview: {
      occurrence_date: window.occurrenceDate,
      starts_at: window.startsAt.toISOString(),
      ends_at: window.endsAt.toISOString(),
      deadline_at: window.deadlineAt.toISOString(),
      invite_at: window.inviteAt.toISOString(),
    },
  };
}

adminRoutes.get('/schedule', async (c) => {
  const config = await getScheduleConfig(c.env.DB);
  return c.json(withSchedulePreview(config));
});

adminRoutes.put('/schedule', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid schedule config', details: parsed.error.flatten() }, 400);
  }
  if (!isValidTimeZone(parsed.data.timezone)) {
    return c.json({ error: `Unknown timezone: ${parsed.data.timezone}` }, 400);
  }
  if (parsed.data.active) {
    const window = computeWeeklyOccurrence({ ...parsed.data, id: 1, updated_at: new Date().toISOString() }, new Date());
    if (window.inviteAt.getTime() >= window.deadlineAt.getTime()) {
      return c.json(
        { error: 'With this invite day/time and deadline, invites would never go out before the deadline.' },
        400,
      );
    }
  }
  const updated = await updateScheduleConfig(c.env.DB, parsed.data);
  return c.json(withSchedulePreview(updated));
});

adminRoutes.get('/bot-info', async (c) => {
  const pendingCount = await countPendingPlayers(c.env.DB);
  return c.json({ bot_username: c.env.TELEGRAM_BOT_USERNAME, pending_count: pendingCount });
});

adminRoutes.get('/players', async (c) => {
  const players = await listPlayers(c.env.DB);
  return c.json({ players });
});

// Players join by messaging the bot themselves (see routes/telegram.ts), so
// there's no "add player" here — only approve/pause/reactivate, rename, and remove.
const playerPatchSchema = z
  .object({
    status: z.enum(['pending', 'active', 'paused']).optional(),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => v.status !== undefined || v.name !== undefined, { message: 'Nothing to update' });

adminRoutes.patch('/players/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null);
  const parsed = playerPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  const before = await getPlayerById(c.env.DB, id);

  if (parsed.data.status !== undefined) {
    await setPlayerStatus(c.env.DB, id, parsed.data.status);
  }
  if (parsed.data.name !== undefined) {
    await setPlayerName(c.env.DB, id, parsed.data.name);
  }

  // The bot's /start reply promises "you'll get a message here once you're
  // approved" — this is what actually fulfills that promise. Only fires on
  // the pending -> active transition (a genuine approval), not a paused ->
  // active reactivation.
  if (before && before.status === 'pending' && parsed.data.status === 'active') {
    await createTelegramClient(c.env)
      .sendMessage(
        before.telegram_chat_id,
        "✅ You're approved! You'll get a message here whenever there's a session to sign up for.",
      )
      .catch((err) => console.error('Failed to send approval notification:', err));
  }

  return c.json({ ok: true });
});

adminRoutes.delete('/players/:id', async (c) => {
  await deletePlayer(c.env.DB, c.req.param('id'));
  return c.json({ ok: true });
});

const createEventSchema = z.object({
  title: z.string().min(1).max(120),
  occurrence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  deadline_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  deadline_time: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().min(1).max(80).default('Europe/Helsinki'),
  venue: z.string().max(200).default(''),
  notes: z.string().max(1000).default(''),
  max_players: z.number().int().min(1).max(200).nullable().optional(),
  send_invites_now: z.boolean().optional(),
});

adminRoutes.get('/events', async (c) => {
  const events = await listEvents(c.env.DB);
  return c.json({ events });
});

adminRoutes.post('/events', async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createEventSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid event payload', details: parsed.error.flatten() }, 400);
  }
  if (!isValidTimeZone(parsed.data.timezone)) {
    return c.json({ error: `Unknown timezone: ${parsed.data.timezone}` }, 400);
  }

  const d = parsed.data;
  const startsAt = zonedDateTimeToUtc(d.occurrence_date, d.start_time, d.timezone);
  let endsAt = zonedDateTimeToUtc(d.occurrence_date, d.end_time, d.timezone);
  if (endsAt <= startsAt) {
    endsAt = new Date(endsAt.getTime() + 24 * 60 * 60 * 1000);
  }
  const deadlineAt = zonedDateTimeToUtc(d.deadline_date, d.deadline_time, d.timezone);
  if (deadlineAt.getTime() >= startsAt.getTime()) {
    return c.json({ error: 'The hard deadline must be before the session starts.' }, 400);
  }

  const event = await createEvent(c.env.DB, {
    title: d.title,
    event_type: 'on_demand',
    occurrence_date: d.occurrence_date,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    deadline_at: deadlineAt.toISOString(),
    timezone: d.timezone,
    venue: d.venue,
    notes: d.notes,
    max_players: d.max_players ?? null,
  });

  await ensureSignupsForEvent(c.env.DB, event.id);

  let inviteResult: { sent: number; failed: number } | null = null;
  if (d.send_invites_now) {
    inviteResult = await dispatchEventInvites(c.env.DB, c.env, event);
  }

  const fresh = await getEventById(c.env.DB, event.id);
  return c.json({ event: fresh, inviteResult }, 201);
});

adminRoutes.get('/events/:id', async (c) => {
  const id = c.req.param('id');
  const event = await getEventById(c.env.DB, id);
  if (!event) {
    return c.json({ error: 'Event not found' }, 404);
  }
  if (event.status === 'open') {
    // Only pull in newly-active players while the event can still accept RSVPs;
    // a past/locked/cancelled event's roster should stay frozen as history.
    await ensureSignupsForEvent(c.env.DB, id);
  }
  const signups = await listSignupsForEvent(c.env.DB, id);
  return c.json({ event, signups });
});

const eventPatchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  venue: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  max_players: z.number().int().min(1).max(200).nullable().optional(),
  status: z.enum(['open', 'locked', 'cancelled']).optional(),
  deadline_at: z.string().datetime().optional(),
  // Reschedule fields: if any of these are present, start/end/deadline are
  // recomputed from them (in the event's existing timezone) rather than used
  // as raw ISO strings, so the UI can send plain date/time pickers.
  occurrence_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  deadline_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  deadline_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  // If true and the save actually changes time/venue/notes/deadline, players
  // who are still pending or accepted get a Telegram notification about it.
  notify: z.boolean().optional(),
});

adminRoutes.patch('/events/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await getEventById(c.env.DB, id);
  if (!existing) return c.json({ error: 'Event not found' }, 404);

  const body = await c.req.json().catch(() => null);
  const parsed = eventPatchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid patch payload', details: parsed.error.flatten() }, 400);
  }
  const { occurrence_date, start_time, end_time, deadline_date, deadline_time, notify, ...rest } = parsed.data;

  const patch: Parameters<typeof updateEvent>[2] = { ...rest };

  const wantsReschedule = occurrence_date || start_time || end_time || deadline_date || deadline_time;
  if (wantsReschedule) {
    // Recompute every timestamp from the event's existing timezone, substituting
    // whichever date/time fields were actually sent, so a partial edit (e.g. just
    // a new deadline_time) doesn't silently drop the other fields.
    const nextDate = occurrence_date ?? existing.occurrence_date;
    // The deadline is often on a different calendar day than the event
    // itself (e.g. "day before") — default to the deadline's OWN existing
    // date, not the (possibly just-changed) occurrence date, or an edit to
    // only start_time/end_time would silently drag the deadline along with it.
    const existingDeadlineLocal = getZonedParts(new Date(existing.deadline_at), existing.timezone);
    const existingDeadlineDate = formatYmd(existingDeadlineLocal.year, existingDeadlineLocal.month, existingDeadlineLocal.day);
    const nextDeadlineDate = deadline_date ?? existingDeadlineDate;
    const resolvedStartsAt = zonedDateTimeToUtc(
      nextDate,
      start_time ?? formatLocalTime(existing.starts_at, existing.timezone),
      existing.timezone,
    );
    let resolvedEndsAt = zonedDateTimeToUtc(
      nextDate,
      end_time ?? formatLocalTime(existing.ends_at, existing.timezone),
      existing.timezone,
    );
    if (resolvedEndsAt <= resolvedStartsAt) {
      resolvedEndsAt = new Date(resolvedEndsAt.getTime() + 24 * 60 * 60 * 1000);
    }
    const resolvedDeadlineAt = zonedDateTimeToUtc(
      nextDeadlineDate,
      deadline_time ?? formatLocalTime(existing.deadline_at, existing.timezone),
      existing.timezone,
    );

    if (resolvedDeadlineAt.getTime() >= resolvedStartsAt.getTime()) {
      return c.json({ error: 'The hard deadline must be before the session starts.' }, 400);
    }

    patch.occurrence_date = nextDate;
    patch.starts_at = resolvedStartsAt.toISOString();
    patch.ends_at = resolvedEndsAt.toISOString();
    patch.deadline_at = resolvedDeadlineAt.toISOString();

    // Rescheduling to a future deadline reopens a previously-locked event.
    if (!patch.status && existing.status === 'locked' && resolvedDeadlineAt.getTime() > Date.now()) {
      patch.status = 'open';
    }
  }

  const updated = await updateEvent(c.env.DB, id, patch);

  let notifyResult: { sent: number; failed: number } | null = null;
  if (notify && updated) {
    const changedLines = diffEventFields(existing, updated);
    if (changedLines.length > 0) {
      notifyResult = await notifyEventUpdated(c.env.DB, c.env, updated, changedLines);
    }
  }

  return c.json({ event: updated, notifyResult });
});

const sendInvitesSchema = z.object({
  mode: z.enum(['new', 'pending', 'all']).default('new'),
  isReminder: z.boolean().optional(),
});

adminRoutes.post('/events/:id/send-invites', async (c) => {
  const id = c.req.param('id');
  const event = await getEventById(c.env.DB, id);
  if (!event) return c.json({ error: 'Event not found' }, 404);
  if (event.status !== 'open' || new Date(event.deadline_at).getTime() <= Date.now()) {
    return c.json({ error: 'Invites can only be sent for an open event before its deadline' }, 409);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = sendInvitesSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  const result = await dispatchEventInvites(c.env.DB, c.env, event, parsed.data);
  return c.json({ ok: true, ...result });
});

adminRoutes.patch('/events/:id/signups/:signupId', async (c) => {
  const signupId = c.req.param('signupId');
  const body = await c.req.json().catch(() => null);
  const parsed = z.object({ status: z.enum(['pending', 'accepted', 'cancelled']) }).safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid status' }, 400);
  }
  await setSignupStatus(c.env.DB, signupId, parsed.data.status, new Date().toISOString());
  return c.json({ ok: true });
});

adminRoutes.post('/cron/tick', async (c) => {
  const summary = await runScheduledTick(c.env.DB, c.env, new Date());
  return c.json({ ok: true, ...summary });
});
