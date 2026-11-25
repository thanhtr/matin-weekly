import { Hono } from 'hono';
import type { ScheduledController, ExecutionContext } from '@cloudflare/workers-types';
import type { Env } from './types';
import { telegramRoutes } from './routes/telegram';
import { adminRoutes, authRoutes } from './routes/admin';
import { runScheduledTick } from './services/scheduler';

export function createApp() {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/telegram', telegramRoutes);
  app.route('/api/auth', authRoutes);
  app.route('/api/admin', adminRoutes);

  app.all('*', async (c) => {
    if (c.env.ASSETS) {
      return c.env.ASSETS.fetch(c.req.raw);
    }
    return c.text('Not Found', 404);
  });

  return app;
}

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledTick(env.DB, env, new Date()));
  },
};
