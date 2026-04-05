# Production deployment checklist

Use this when publishing the site (e.g. Vercel + Supabase).

## 1. Verify the build locally

```bash
npm install
npm run build
```

Fix any TypeScript or build errors before deploying. Run `npm start` and smoke-test critical paths (home, login, signup, betting).

## 2. Environment variables (hosting dashboard)

Copy from `.env.example` into your provider (Vercel → Project → Settings → Environment Variables). Set **Production** (and Preview if you use PR previews).

| Variable | Required for | Notes |
|----------|----------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Auth, client | Same Supabase project in prod |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Auth, client | Public anon key |
| `SUPABASE_DB_URL` | API routes using Postgres | Use Supabase **connection string**; prefer **pooler** if recommended for serverless |
| `CRON_SECRET` or `PAPER_SETTLE_CRON_SECRET` | `/api/cron/paper-settle` in production | See §4 |
| `OPENAI_API_KEY` | AI betting features | Optional if those routes fail closed or you disable them |
| `OPENAI_MODEL` | AI | Defaults to `gpt-4o-mini` if unset |

Never commit `.env` or paste secrets into the repo.

## 3. Supabase (production)

- **Authentication → URL configuration:** Site URL = your production origin (e.g. `https://yourdomain.com`). Add `https://yourdomain.com/auth/callback` to **Redirect URLs** (and `http://localhost:3000/...` for local dev).
- **Email:** Custom SMTP (e.g. Resend) and templates for confirm signup.
- **Google OAuth:** Authorized redirect URI in Google Cloud remains `https://<project-ref>.supabase.co/auth/v1/callback` (not your app domain).
- **RLS / policies:** Confirm policies match what you expect for logged-in users.

## 4. Vercel Cron and paper settlement

`vercel.json` schedules `GET /api/cron/paper-settle` **once per day** at **12:00 UTC** (`0 12 * * *`).

**Hobby vs Pro:** On **Vercel Hobby**, cron jobs are limited to **at most one run per day**. Schedules like every 15 minutes require **Pro** (or run settlement manually / via an external scheduler that calls the same URL with your secret). If you upgrade to Pro, you can change the schedule in `vercel.json` (e.g. `*/15 * * * *` for every 15 minutes).

In **production**, the route returns **503** if no cron secret is set, and **401** if the request is not authorized.

- Set **`CRON_SECRET`** in Vercel to a long random string. When this variable exists, Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron requests; your handler accepts `CRON_SECRET` or `PAPER_SETTLE_CRON_SECRET` as the bearer token (or `?secret=` for manual testing).

After deploy, confirm cron runs in Vercel → project → Cron / Logs, or call the endpoint once with the correct bearer.

## 5. Domain and HTTPS

- Point DNS to Vercel (or your host) and enable HTTPS (default on Vercel).
- Update Supabase redirect URLs and any third-party OAuth redirect allowlists to use `https://`.

## 6. Optional hardening

- **Rate limits:** Supabase Auth rate limits; consider CAPTCHA for auth if you see abuse.
- **Admin routes:** Restrict or protect `/admin/*` if exposed publicly.
- **Monitoring:** Enable Vercel Analytics / Log Drains; watch 5xx and cron failures.

## 7. Build warnings you may see

- **`middleware` file convention is deprecated (use `proxy`)** — Next.js 16 migration; build still succeeds. Follow [Next.js middleware → proxy](https://nextjs.org/docs/messages/middleware-to-proxy) when you upgrade the pattern.
- **`baseline-browser-mapping` is old** — optional devDependency update: `npm i baseline-browser-mapping@latest -D`.

## Quick post-launch smoke test

1. Open production `/` and `/betting`.
2. Sign up or log in (email + Google); confirm redirect and session.
3. Hit a DB-backed API (e.g. betting games) and confirm no 500s.
4. If you use cron settlement, confirm one successful cron execution in logs.
