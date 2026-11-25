import { describe, expect, it } from 'vitest';
import { createApp } from '../src/worker/index';
import type { Env } from '../src/worker/types';
import { runScheduledTick } from '../src/worker/services/scheduler';
import { createTestD1 } from './helpers/mockD1';

const WEBHOOK_SECRET = 'test-webhook-secret';

function createTestEnv(): Env {
  return {
    DB: createTestD1(),
    DEFAULT_TIMEZONE: 'Europe/Helsinki',
    ADMIN_PASSWORD: 'super-secret-password',
    SESSION_SECRET: 'test-session-secret-32-chars-long',
    TELEGRAM_BOT_USERNAME: 'matin_weekly_bot',
    // TELEGRAM_BOT_TOKEN intentionally left unset: services/telegram.ts falls
    // back to a console-logging stub, so tests never hit the real network.
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
  };
}

type TestApp = ReturnType<typeof createApp>;

async function login(app: TestApp, env: Env): Promise<string> {
  const res = await app.request(
    '/api/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'super-secret-password' }),
    },
    env,
  );
  return res.headers.get('set-cookie')!.split(';')[0];
}

async function startBot(
  app: TestApp,
  env: Env,
  chatId: string,
  opts: { username?: string; firstName?: string } = {},
) {
  return app.request(
    '/api/telegram/webhook',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      body: JSON.stringify({
        message: {
          text: '/start',
          chat: { id: chatId },
          from: { id: chatId, username: opts.username, first_name: opts.firstName ?? '' },
        },
      }),
    },
    env,
  );
}

async function sendCallback(app: TestApp, env: Env, chatId: string, data: string) {
  return app.request(
    '/api/telegram/webhook',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
      body: JSON.stringify({
        callback_query: {
          id: `cbq-${Math.random()}`,
          data,
          from: { id: chatId },
          message: { chat: { id: chatId }, message_id: 1 },
        },
      }),
    },
    env,
  );
}

async function approvePlayer(app: TestApp, env: Env, cookie: string, chatId: string): Promise<string> {
  const res = await app.request('/api/admin/players', { headers: { cookie } }, env);
  const { players } = (await res.json()) as { players: Array<{ id: string; telegram_chat_id: string }> };
  const player = players.find((p) => p.telegram_chat_id === chatId);
  if (!player) throw new Error(`No player found for chat ${chatId}`);
  await app.request(
    `/api/admin/players/${player.id}`,
    { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ status: 'active' }) },
    env,
  );
  return player.id;
}

describe('Badminton API & Telegram RSVP flow', () => {
  it('requires admin auth for protected endpoints and supports login', async () => {
    const app = createApp();
    const env = createTestEnv();

    const unauth = await app.request('/api/admin/events', {}, env);
    expect(unauth.status).toBe(401);

    const badLogin = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' }),
      },
      env,
    );
    expect(badLogin.status).toBe(401);

    const goodLogin = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: 'super-secret-password' }),
      },
      env,
    );
    expect(goodLogin.status).toBe(200);
    const cookie = goodLogin.headers.get('set-cookie');
    expect(cookie).toContain('badminton_admin=');

    const authed = await app.request(
      '/api/admin/events',
      { headers: { cookie: cookie!.split(';')[0] } },
      env,
    );
    expect(authed.status).toBe(200);
  });

  it('rejects webhook calls with a missing or wrong secret header', async () => {
    const app = createApp();
    const env = createTestEnv();

    const missing = await app.request(
      '/api/telegram/webhook',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      env,
    );
    expect(missing.status).toBe(401);

    const wrong = await app.request(
      '/api/telegram/webhook',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'nope' },
        body: '{}',
      },
      env,
    );
    expect(wrong.status).toBe(401);
  });

  it('/start creates a pending player with no signups until the admin approves them', async () => {
    const app = createApp();
    const env = createTestEnv();
    const cookie = await login(app, env);

    const startRes = await startBot(app, env, 'chat-1', { username: 'newbie', firstName: 'Newbie' });
    expect(startRes.status).toBe(200);

    const playersRes = await app.request('/api/admin/players', { headers: { cookie } }, env);
    const { players } = (await playersRes.json()) as { players: Array<{ status: string; telegram_chat_id: string }> };
    const player = players.find((p) => p.telegram_chat_id === 'chat-1')!;
    expect(player.status).toBe('pending');

    const createEv = await app.request(
      '/api/admin/events',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          title: 'Sunday Smash',
          occurrence_date: '2099-05-10',
          start_time: '18:00',
          end_time: '20:00',
          deadline_date: '2099-05-09',
          deadline_time: '18:00',
          timezone: 'Europe/Helsinki',
          send_invites_now: true,
        }),
      },
      env,
    );
    const { event } = (await createEv.json()) as { event: { id: string } };
    const detailRes = await app.request(`/api/admin/events/${event.id}`, { headers: { cookie } }, env);
    const detail = (await detailRes.json()) as { signups: unknown[] };
    expect(detail.signups).toHaveLength(0); // pending player gets no signup yet

    // re-starting doesn't reset an already-pending row to something else, and
    // once approved, re-starting again must not bounce them back to pending
    await approvePlayer(app, env, cookie, 'chat-1');
    await startBot(app, env, 'chat-1', { username: 'newbie', firstName: 'Newbie' });
    const afterRestart = await app.request('/api/admin/players', { headers: { cookie } }, env);
    const { players: after } = (await afterRestart.json()) as { players: Array<{ status: string; telegram_chat_id: string }> };
    expect(after.find((p) => p.telegram_chat_id === 'chat-1')!.status).toBe('active');
  });

  it('handles on-demand event creation, accept/cancel RSVP via Telegram callbacks, capacity, ownership, and deadline lock', async () => {
    const app = createApp();
    const env = createTestEnv();
    const cookie = await login(app, env);

    await startBot(app, env, 'chat-alice', { username: 'alice' });
    await startBot(app, env, 'chat-bob', { username: 'bob' });
    await approvePlayer(app, env, cookie, 'chat-alice');
    await approvePlayer(app, env, cookie, 'chat-bob');

    const createEv = await app.request(
      '/api/admin/events',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          title: 'Sunday Smash',
          occurrence_date: '2099-05-10',
          start_time: '18:00',
          end_time: '20:00',
          deadline_date: '2099-05-09',
          deadline_time: '18:00',
          timezone: 'Europe/Helsinki',
          venue: 'Arena 1',
          notes: 'Bring shuttles',
          max_players: 1,
          send_invites_now: true,
        }),
      },
      env,
    );
    expect(createEv.status).toBe(201);
    const createdBody = (await createEv.json()) as { event: { id: string } };
    const eventId = createdBody.event.id;

    const detailRes = await app.request(`/api/admin/events/${eventId}`, { headers: { cookie } }, env);
    const detail = (await detailRes.json()) as {
      signups: Array<{ signup_id: string; telegram_username: string | null }>;
    };
    const aliceSignup = detail.signups.find((s) => s.telegram_username === 'alice')!.signup_id;
    const bobSignup = detail.signups.find((s) => s.telegram_username === 'bob')!.signup_id;

    // A third party can't act on someone else's signup
    const forged = await sendCallback(app, env, 'chat-mallory', `rsvp:${aliceSignup}:accept`);
    expect(forged.status).toBe(200); // Telegram always gets 200; rejection shows as an alert callback answer

    // Alice accepts
    const acceptRes = await sendCallback(app, env, 'chat-alice', `rsvp:${aliceSignup}:accept`);
    expect(acceptRes.status).toBe(200);

    // Bob tries to accept when max_players=1 -> rejected (the signup stays pending)
    await sendCallback(app, env, 'chat-bob', `rsvp:${bobSignup}:accept`);
    const stillFullRes = await app.request(`/api/admin/events/${eventId}`, { headers: { cookie } }, env);
    const stillFull = (await stillFullRes.json()) as { signups: Array<{ signup_id: string; status: string }> };
    expect(stillFull.signups.find((s) => s.signup_id === bobSignup)!.status).toBe('pending');

    // Alice cancels -> Bob can now accept
    await sendCallback(app, env, 'chat-alice', `rsvp:${aliceSignup}:cancel`);
    await sendCallback(app, env, 'chat-bob', `rsvp:${bobSignup}:accept`);
    const afterSwap = await app.request(`/api/admin/events/${eventId}`, { headers: { cookie } }, env);
    const afterSwapBody = (await afterSwap.json()) as { signups: Array<{ signup_id: string; status: string }> };
    expect(afterSwapBody.signups.find((s) => s.signup_id === bobSignup)!.status).toBe('accepted');

    // Move deadline into the past -> Bob can no longer cancel
    await app.request(
      `/api/admin/events/${eventId}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ deadline_at: '2020-01-01T00:00:00.000Z' }),
      },
      env,
    );
    await sendCallback(app, env, 'chat-bob', `rsvp:${bobSignup}:cancel`);
    const pastDeadline = await app.request(`/api/admin/events/${eventId}`, { headers: { cookie } }, env);
    const pastDeadlineBody = (await pastDeadline.json()) as { signups: Array<{ signup_id: string; status: string }> };
    expect(pastDeadlineBody.signups.find((s) => s.signup_id === bobSignup)!.status).toBe('accepted');
  });

  it('runs recurring weekly tick idempotently and sends one pre-deadline reminder', async () => {
    const app = createApp();
    const env = createTestEnv();
    const cookie = await login(app, env);

    await startBot(app, env, 'chat-p1', { username: 'p1' });
    await approvePlayer(app, env, cookie, 'chat-p1');

    await app.request(
      '/api/admin/schedule',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          active: true,
          title_template: 'Wednesday Badminton',
          play_weekday: 3,
          play_start_time: '19:00',
          play_end_time: '21:00',
          venue: 'Arena',
          timezone: 'Europe/Helsinki',
          invite_weekday: 1,
          invite_time: '09:00',
          deadline_hours_before: 24,
          reminder_hours_before_deadline: 6,
          max_players: null,
        }),
      },
      env,
    );

    // Monday 2026-11-23 10:00 Helsinki (08:00 UTC) -> creates event & sends invite
    const tick1 = await runScheduledTick(env.DB, env, new Date('2026-11-23T08:00:00.000Z'));
    expect(tick1.createdRecurring).toBe(true);
    expect(tick1.invitesSent).toBe(1);
    expect(tick1.remindersSent).toBe(0);

    // Re-running 15m later is idempotent
    const tick2 = await runScheduledTick(env.DB, env, new Date('2026-11-23T08:15:00.000Z'));
    expect(tick2.createdRecurring).toBe(false);
    expect(tick2.invitesSent).toBe(0);

    // Tuesday 2026-11-24 14:00 Helsinki (12:00 UTC) — 5h before 19:00 Helsinki deadline -> sends 1 reminder
    const tick3 = await runScheduledTick(env.DB, env, new Date('2026-11-24T12:00:00.000Z'));
    expect(tick3.remindersSent).toBe(1);

    // Re-running doesn't send duplicate reminder
    const tick4 = await runScheduledTick(env.DB, env, new Date('2026-11-24T12:15:00.000Z'));
    expect(tick4.remindersSent).toBe(0);
  });

  it('rejects sending invites for a locked/past-deadline event', async () => {
    const app = createApp();
    const env = createTestEnv();
    const cookie = await login(app, env);

    const createEv = await app.request(
      '/api/admin/events',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          title: 'Past Event',
          occurrence_date: '2099-01-10',
          start_time: '18:00',
          end_time: '20:00',
          deadline_date: '2020-01-01',
          deadline_time: '00:00',
          timezone: 'Europe/Helsinki',
          venue: '',
          notes: '',
          send_invites_now: false,
        }),
      },
      env,
    );
    const { event } = (await createEv.json()) as { event: { id: string } };

    const res = await app.request(
      `/api/admin/events/${event.id}/send-invites`,
      { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' },
      env,
    );
    expect(res.status).toBe(409);
  });

  it('sends exactly one invite to a player approved after the first send, on the next tick', async () => {
    const app = createApp();
    const env = createTestEnv();
    const cookie = await login(app, env);

    await startBot(app, env, 'chat-early', { username: 'early' });
    await approvePlayer(app, env, cookie, 'chat-early');

    await app.request(
      '/api/admin/schedule',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          active: true,
          title_template: 'Wednesday Badminton',
          play_weekday: 3,
          play_start_time: '19:00',
          play_end_time: '21:00',
          venue: 'Arena',
          timezone: 'Europe/Helsinki',
          invite_weekday: 1,
          invite_time: '09:00',
          deadline_hours_before: 24,
          reminder_hours_before_deadline: 0,
          max_players: null,
        }),
      },
      env,
    );

    const tick1 = await runScheduledTick(env.DB, env, new Date('2026-11-23T08:00:00.000Z'));
    expect(tick1.invitesSent).toBe(1);

    // A second player starts the bot and gets approved after invites already went out.
    await startBot(app, env, 'chat-late', { username: 'late' });
    await approvePlayer(app, env, cookie, 'chat-late');

    const tick2 = await runScheduledTick(env.DB, env, new Date('2026-11-23T08:15:00.000Z'));
    expect(tick2.createdRecurring).toBe(false);
    expect(tick2.invitesSent).toBe(1); // only the late joiner

    const tick3 = await runScheduledTick(env.DB, env, new Date('2026-11-23T08:30:00.000Z'));
    expect(tick3.invitesSent).toBe(0); // no one left to invite
  });

  it('recomputes starts_at/deadline_at when PATCH changes date or time fields', async () => {
    const app = createApp();
    const env = createTestEnv();
    const cookie = await login(app, env);

    const createEv = await app.request(
      '/api/admin/events',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({
          title: 'Reschedule Me',
          occurrence_date: '2099-06-10',
          start_time: '18:00',
          end_time: '20:00',
          deadline_date: '2099-06-09',
          deadline_time: '18:00',
          timezone: 'Europe/Helsinki',
          venue: '',
          notes: '',
          send_invites_now: false,
        }),
      },
      env,
    );
    const created = (await createEv.json()) as { event: { id: string } };

    const patchRes = await app.request(
      `/api/admin/events/${created.event.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ start_time: '20:00' }),
      },
      env,
    );
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as { event: { starts_at: string; occurrence_date: string } };
    expect(patched.event.occurrence_date).toBe('2099-06-10');
    expect(patched.event.starts_at).toBe('2099-06-10T17:00:00.000Z'); // 20:00 EEST (summer, UTC+3)
  });
});
