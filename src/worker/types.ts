import type { D1Database, Fetcher } from '@cloudflare/workers-types';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  DEFAULT_TIMEZONE: string;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
  // Public (non-secret): used to build the "share this link" invite URL.
  TELEGRAM_BOT_USERNAME: string;
  // Secrets. TELEGRAM_BOT_TOKEN is optional so local dev/tests can run
  // without a real bot (services/telegram.ts falls back to a console stub).
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  // Optional: if set, the bot DMs this chat id whenever someone new requests
  // to join, so the admin doesn't have to poll the dashboard.
  TELEGRAM_ADMIN_CHAT_ID?: string;
}
