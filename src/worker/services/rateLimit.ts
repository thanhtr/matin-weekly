import type { D1Database } from '@cloudflare/workers-types';

interface RateLimitRow {
  key: string;
  count: number;
  window_start: string;
}

/**
 * Fixed-window counter shared by every rate-limited endpoint (admin login,
 * the Telegram webhook). Returns true if the call is allowed (and records
 * it), false if the key is already over its limit for the current window.
 */
export async function checkRateLimit(
  db: D1Database,
  key: string,
  opts: { maxAttempts: number; windowSeconds: number },
): Promise<boolean> {
  const now = Date.now();
  const row = await db.prepare('SELECT * FROM rate_limit_counters WHERE key = ?').bind(key).first<RateLimitRow>();

  if (!row || now - new Date(row.window_start).getTime() >= opts.windowSeconds * 1000) {
    // No row yet, or the previous window has expired: start a fresh one.
    await db
      .prepare(
        `INSERT INTO rate_limit_counters (key, count, window_start)
         VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start`,
      )
      .bind(key, new Date(now).toISOString())
      .run();
    return true;
  }

  if (row.count >= opts.maxAttempts) {
    return false;
  }

  await db.prepare('UPDATE rate_limit_counters SET count = count + 1 WHERE key = ?').bind(key).run();
  return true;
}

export async function resetRateLimit(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM rate_limit_counters WHERE key = ?').bind(key).run();
}
