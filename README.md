# Matin Weekly Badminton

A 100% free-tier web app for managing weekly and on-demand badminton play signups, Telegram-bot RSVPs with hard deadlines, a password-protected admin dashboard, and a print-friendly final roster.

## Free Stack
- **Hosting + Cron + Static Assets**: Cloudflare Workers Free (100,000 req/day, cron triggers up to every 1 min)
- **Database**: Cloudflare D1 Free (5M reads/day, 100K writes/day, 5GB storage)
- **Invites/RSVP**: A Telegram bot (free, no per-message limits at this scale, no domain/DKIM/DMARC story to manage)

## Setting up the Telegram bot
1. In Telegram, message **@BotFather** → `/newbot` → follow the prompts to pick a name and a username (must end in `bot`, e.g. `matin_weekly_bot`). It replies with an API token — keep it secret.
2. Put the username (without the `@`) in `wrangler.jsonc`'s `vars.TELEGRAM_BOT_USERNAME`.
3. Pick a random webhook secret (e.g. `openssl rand -hex 32`) — this guards the public webhook endpoint against forged requests.
4. After deploying (see below), register the webhook once:
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-worker-url>/api/telegram/webhook&secret_token=<WEBHOOK_SECRET>"
   ```
5. Optional: message your own bot once (`/start`) and check the dashboard's Pending list for your chat id if you want the bot to DM you (`TELEGRAM_ADMIN_CHAT_ID`) whenever someone new requests to join.

### How players join
Share `https://t.me/<your_bot_username>` in your group chat. Anyone who starts the bot shows up in the admin dashboard's **Players → Pending Approval** list — they get no invites and can't RSVP until you approve them there. Approved players can be paused or removed later from the same tab.

## Local Development
1. Copy `.dev.vars.example` to `.dev.vars`:
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   You can leave `TELEGRAM_BOT_TOKEN` unset for local dev/tests — `services/telegram.ts` falls back to a console-logging stub (prints what it would have sent) so you don't need a real bot to develop against.
2. Apply local D1 migrations (`0001_init.sql` creates the schema, `0002_signup_invited_at.sql` adds per-signup invite tracking, `0003_telegram_rework.sql` replaces the email-based player/RSVP model with Telegram):
   ```bash
   npm run db:migrate:local
   ```
3. Build the frontend once before running the worker — `wrangler dev` serves static assets straight from `dist/client`, it does not run Vite for you:
   ```bash
   npm run build
   ```
4. Run tests and start the local dev server:
   ```bash
   npm test
   npm run dev:worker
   ```
   Or `npm run dev` to run Vite (with hot reload, proxying `/api` to the Worker) and `wrangler dev` together.

   Open `http://localhost:8787/admin` and log in with `ADMIN_PASSWORD` from `.dev.vars`. With no bot token set, invite messages print to the console instead of hitting Telegram.

   Useful local curl commands:
   - Trigger a cron tick: `curl -X POST http://localhost:8787/api/admin/cron/tick -H 'cookie: badminton_admin=...'`
   - Simulate a Telegram `/start`: `curl -X POST http://localhost:8787/api/telegram/webhook -d '{"message":{"text":"/start","chat":{"id":"123"},"from":{"id":"123","first_name":"Test"}}}'`

## Deploy to Cloudflare (Free Tier)
1. Authenticate and create your D1 database:
   ```bash
   npx wrangler login
   npx wrangler d1 create matin-weekly-db
   ```
   Paste the returned `database_id` into `wrangler.jsonc`, and set `TELEGRAM_BOT_USERNAME`.
2. Set secrets:
   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   npx wrangler secret put SESSION_SECRET
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
   ```
3. Apply the remote migrations and deploy:
   ```bash
   npm run db:migrate:remote
   npm run deploy
   ```
4. Register the webhook (see the bot setup section above) if you haven't already, using the deployed `https://matin-weekly.<your-subdomain>.workers.dev` URL.
