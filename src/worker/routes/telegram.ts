import { Hono } from 'hono';
import type { Env } from '../types';
import { getSignupById, setSignupStatusIfOpen, upsertPlayerFromTelegram } from '../db/queries';
import {
  createTelegramClient,
  parseInviteCallbackData,
  renderInviteMessage,
  inviteButtons,
  type TelegramUpdate,
} from '../services/telegram';

export const telegramRoutes = new Hono<{ Bindings: Env }>();

telegramRoutes.post('/webhook', async (c) => {
  // Telegram lets you set a secret token on the webhook registration that it
  // echoes back on every call, so a forged POST to this public URL can't
  // pretend to be real Telegram traffic.
  if (c.env.TELEGRAM_WEBHOOK_SECRET) {
    const header = c.req.header('x-telegram-bot-api-secret-token');
    if (header !== c.env.TELEGRAM_WEBHOOK_SECRET) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }

  const update = (await c.req.json().catch(() => null)) as TelegramUpdate | null;
  // Telegram expects a 200 regardless of what's inside, or it will keep
  // retrying the same update.
  if (!update) return c.json({ ok: true });

  const bot = createTelegramClient(c.env);

  if (update.message?.text?.startsWith('/start')) {
    const chat = update.message.chat;
    const from = update.message.from;
    const chatId = String(chat.id);
    const player = await upsertPlayerFromTelegram(c.env.DB, {
      chatId,
      username: from?.username ?? null,
      name: from?.first_name ?? '',
    });

    const text =
      player.status === 'pending'
        ? "Thanks! Your request to join has been sent to the admin — you'll get a message here once you're approved."
        : player.status === 'active'
          ? "You're already on the roster — you'll get a message here whenever there's a session."
          : "You're currently paused on the roster. Ask the admin to reactivate you.";
    await bot.sendMessage(chatId, text);

    if (player.status === 'pending' && c.env.TELEGRAM_ADMIN_CHAT_ID) {
      const label = from?.username ? `@${from.username}` : from?.first_name || 'Someone';
      await bot
        .sendMessage(c.env.TELEGRAM_ADMIN_CHAT_ID, `New join request from ${label} — approve them in the admin dashboard.`)
        .catch((err) => console.error('Failed to notify admin of new join request:', err));
    }
    return c.json({ ok: true });
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const parsed = cq.data ? parseInviteCallbackData(cq.data) : null;
    if (!parsed) {
      await bot.answerCallbackQuery(cq.id, 'Unrecognized action.');
      return c.json({ ok: true });
    }

    const signup = await getSignupById(c.env.DB, parsed.signupId);
    if (!signup || signup.telegram_chat_id !== String(cq.from.id)) {
      await bot.answerCallbackQuery(cq.id, "This isn't your signup.", true);
      return c.json({ ok: true });
    }

    const status = parsed.action === 'accept' ? 'accepted' : 'cancelled';
    const nowIso = new Date().toISOString();
    const updated = await setSignupStatusIfOpen(c.env.DB, parsed.signupId, status, nowIso);

    if (!updated) {
      await bot.answerCallbackQuery(
        cq.id,
        'Too late — the deadline has passed, the event changed, or the session is full.',
        true,
      );
      return c.json({ ok: true });
    }

    if (cq.message) {
      const statusLine =
        status === 'accepted'
          ? "\n\n✅ <b>You're signed up!</b> Tap Cancel below if that changes."
          : '\n\n❌ <b>Cancelled.</b> Tap Accept below if you change your mind.';
      const text = renderInviteMessage({ event: signup.event, playerName: signup.player_name }) + statusLine;
      await bot.editMessageText(String(cq.message.chat.id), cq.message.message_id, text, inviteButtons(parsed.signupId));
    }
    await bot.answerCallbackQuery(cq.id, status === 'accepted' ? 'Signed up!' : 'Cancelled.');
    return c.json({ ok: true });
  }

  return c.json({ ok: true });
});
