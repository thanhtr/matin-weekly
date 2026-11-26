import type { BadmintonEvent, SignupStatus } from '../../shared/types';
import type { Env } from '../types';
import { formatLocalDateTime, formatLocalTime } from './timezone';

export interface InlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramClient {
  sendMessage(chatId: string, text: string, replyMarkup?: InlineButton[][]): Promise<{ message_id: number } | null>;
  editMessageText(chatId: string, messageId: number, text: string, replyMarkup?: InlineButton[][]): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text?: string, showAlert?: boolean): Promise<void>;
}

// Minimal subset of Telegram's Update schema — just the fields this bot uses.
export interface TelegramUpdate {
  message?: {
    text?: string;
    chat: { id: number | string };
    from?: { id: number | string; username?: string; first_name?: string; last_name?: string };
  };
  callback_query?: {
    id: string;
    data?: string;
    from: { id: number | string };
    message?: {
      chat: { id: number | string };
      message_id: number;
    };
  };
}

function escapeHtml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Real Telegram Bot API client. Every call is a plain HTTPS POST, so it works
 * fine from a Worker with no extra dependency.
 */
class HttpTelegramClient implements TelegramClient {
  constructor(private readonly token: string) {}

  private async call(method: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string; result?: unknown } | null;
    if (!res.ok || !data?.ok) {
      throw new Error(`Telegram ${method} error (${res.status}): ${data?.description ?? 'unknown error'}`);
    }
    return data.result;
  }

  async sendMessage(chatId: string, text: string, replyMarkup?: InlineButton[][]): Promise<{ message_id: number } | null> {
    const result = (await this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup ? { inline_keyboard: replyMarkup } : undefined,
    })) as { message_id: number } | null;
    return result;
  }

  async editMessageText(chatId: string, messageId: number, text: string, replyMarkup?: InlineButton[][]): Promise<void> {
    await this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      reply_markup: replyMarkup ? { inline_keyboard: replyMarkup } : undefined,
    });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string, showAlert?: boolean): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, text, show_alert: showAlert });
  }
}

/** No-op stub used for local dev/tests when no real bot token is configured. */
class ConsoleTelegramClient implements TelegramClient {
  private nextMessageId = 1;

  async sendMessage(chatId: string, text: string): Promise<{ message_id: number }> {
    console.log(`[TELEGRAM:console] To chat=${chatId}\n${text}\n---`);
    return { message_id: this.nextMessageId++ };
  }

  async editMessageText(chatId: string, messageId: number, text: string): Promise<void> {
    console.log(`[TELEGRAM:console] Edit chat=${chatId} message=${messageId}\n${text}\n---`);
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    console.log(`[TELEGRAM:console] Ack callback=${callbackQueryId} text=${text ?? ''}`);
  }
}

export function createTelegramClient(env: Env): TelegramClient {
  if (env.TELEGRAM_BOT_TOKEN) {
    return new HttpTelegramClient(env.TELEGRAM_BOT_TOKEN);
  }
  return new ConsoleTelegramClient();
}

export function inviteCallbackData(signupId: string, action: 'accept' | 'cancel'): string {
  return `rsvp:${signupId}:${action}`;
}

export function parseInviteCallbackData(data: string): { signupId: string; action: 'accept' | 'cancel' } | null {
  const match = data.match(/^rsvp:([^:]+):(accept|cancel)$/);
  if (!match) return null;
  return { signupId: match[1], action: match[2] as 'accept' | 'cancel' };
}

export function renderInviteMessage(params: {
  event: BadmintonEvent;
  playerName: string;
  isReminder?: boolean;
}): string {
  const { event, playerName, isReminder } = params;
  const startFormatted = formatLocalDateTime(event.starts_at, event.timezone);
  const endTimeFormatted = formatLocalTime(event.ends_at, event.timezone);
  const deadlineFormatted = formatLocalDateTime(event.deadline_at, event.timezone);
  const greeting = playerName.trim() || 'there';

  const lines = [
    `<b>${escapeHtml(event.title)}</b>`,
    '',
    `Hi ${escapeHtml(greeting)},`,
    isReminder
      ? `Friendly reminder — you haven't responded yet for this session.`
      : `You're invited to play!`,
    '',
    `🗓 <b>When:</b> ${escapeHtml(startFormatted)} – ${escapeHtml(endTimeFormatted)} (${escapeHtml(event.timezone)})`,
  ];
  if (event.venue) lines.push(`📍 <b>Venue:</b> ${escapeHtml(event.venue)}`);
  if (event.notes) lines.push(`📝 <b>Notes:</b> ${escapeHtml(event.notes)}`);
  lines.push(`⏰ <b>Hard deadline:</b> ${escapeHtml(deadlineFormatted)}`);

  return lines.join('\n');
}

/**
 * Human-readable "what changed" lines for the five fields a player actually
 * cares about. Title/max_players aren't included here on purpose — changing
 * only those shouldn't pre-check the "notify" box or produce a message with
 * nothing meaningful to say.
 */
export function diffEventFields(before: BadmintonEvent, after: BadmintonEvent): string[] {
  const lines: string[] = [];
  const tz = before.timezone;

  if (before.starts_at !== after.starts_at || before.ends_at !== after.ends_at) {
    const was = `${formatLocalDateTime(before.starts_at, tz)} – ${formatLocalTime(before.ends_at, tz)}`;
    const now = `${formatLocalDateTime(after.starts_at, tz)} – ${formatLocalTime(after.ends_at, tz)}`;
    lines.push(`🗓 <b>When:</b> ${escapeHtml(now)} (was ${escapeHtml(was)})`);
  }
  if (before.venue !== after.venue) {
    lines.push(`📍 <b>Venue:</b> ${escapeHtml(after.venue || '—')} (was ${escapeHtml(before.venue || '—')})`);
  }
  if (before.notes !== after.notes) {
    lines.push(`📝 <b>Notes:</b> ${escapeHtml(after.notes || '—')} (was ${escapeHtml(before.notes || '—')})`);
  }
  if (before.deadline_at !== after.deadline_at) {
    lines.push(
      `⏰ <b>Hard deadline:</b> ${escapeHtml(formatLocalDateTime(after.deadline_at, tz))} (was ${escapeHtml(formatLocalDateTime(before.deadline_at, tz))})`,
    );
  }

  return lines;
}

export function renderEventUpdateMessage(params: {
  event: BadmintonEvent;
  playerName: string;
  changedLines: string[];
}): string {
  const { event, playerName, changedLines } = params;
  const greeting = playerName.trim() || 'there';

  return [
    `⚠️ <b>${escapeHtml(event.title)} was updated</b>`,
    '',
    `Hi ${escapeHtml(greeting)}, here's what changed:`,
    '',
    ...changedLines,
  ].join('\n');
}

/**
 * Before a response (status undefined/'pending'), show both actions. Once
 * the player has responded, only the action that still makes sense stays —
 * collapsing to one button makes the "did my tap register" outcome visually
 * unambiguous, instead of two identical-looking buttons sitting there.
 */
export function inviteButtons(signupId: string, status?: SignupStatus): InlineButton[][] {
  if (status === 'accepted') {
    return [[{ text: '❌ Cancel signup', callback_data: inviteCallbackData(signupId, 'cancel') }]];
  }
  if (status === 'cancelled') {
    return [[{ text: '✅ Accept', callback_data: inviteCallbackData(signupId, 'accept') }]];
  }
  return [
    [
      { text: '✅ Accept', callback_data: inviteCallbackData(signupId, 'accept') },
      { text: '❌ Cancel', callback_data: inviteCallbackData(signupId, 'cancel') },
    ],
  ];
}
