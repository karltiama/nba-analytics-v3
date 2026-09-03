# Production deployment checklist

Use this when publishing the site (e.g. Vercel + Supabase).

## 1. Verify the build locally

```bash
npm install
npm run build
```

Fix any TypeScript or build errors before deploying. Run `npm start` and smoke-test critical paths (home, login, signup, betting).

The **`lambda/`** folder is excluded from the root `tsconfig.json` so Vercel’s Next.js build does not typecheck AWS Lambda code (`aws-lambda` types, etc.). Build and typecheck each function under `lambda/<name>/` with its own `package.json` when you change Lambdas.

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

### Credential hygiene (Phase 1A.1)

- Local Terraform secrets belong only in **untracked** `infra/terraform.tfvars` (gitignored via `infra/.gitignore` `*.tfvars`). Use `infra/terraform.tfvars.example` as the template.
- Do not commit Lambda diagnostic scripts with real connection strings. Use `SUPABASE_DB_URL` from the environment.
- If a database password or API key was ever committed (including historical commits), **rotate it at the provider** — deleting it from the latest tree does not invalidate the old credential.
- Offseason freeze flags (`DATA_MODE=replay`, `OFFSEASON_MODE=1`, `CRON_DRY_RUN=1`) are unrelated to auth; keep them until you intentionally re-enable the live pipeline.
- **Vercel Production must set those freeze flags explicitly.** Missing `DATA_MODE` no longer defaults prune to live; destructive `/api/cron/prune-props` also requires `PRUNE_ENABLED=1` (leave unset/0 in offseason).

## 3. Supabase (production)

- **Authentication → URL configuration:** Site URL = your production origin (e.g. `https://yourdomain.com`). Add `https://yourdomain.com/auth/callback` to **Redirect URLs** (and `http://localhost:3000/...` for local dev).
- **Email:** Custom SMTP (e.g. Resend) and templates for confirm signup.
- **Google OAuth:** Authorized redirect URI in Google Cloud remains `https://<project-ref>.supabase.co/auth/v1/callback` (not your app domain).
- **RLS / policies:** Confirm policies match what you expect for logged-in users.

## 4. Vercel Cron and paper settlement

`vercel.json` schedules:

- `GET /api/cron/paper-settle` daily at **12:00 UTC**
- `GET /api/cron/prune-props` daily at **13:00 UTC**

Authorization is shared via `lib/auth/cron-auth.ts`:

- Production **requires** `CRON_SECRET` (and optionally `PAPER_SETTLE_CRON_SECRET` for paper-settle).
- Missing secret in production → **503**.
- Invalid/missing Authorization → **401**.
- When `CRON_SECRET` is set in Vercel, cron invocations send `Authorization: Bearer <CRON_SECRET>` automatically.
- Manual testing may also use `?secret=` (prefer Bearer; query secrets can appear in logs).

**Hobby vs Pro:** On **Vercel Hobby**, cron jobs are limited to **at most one run per day**. Schedules like every 15 minutes require **Pro**.

AWS EventBridge → Lambda jobs do **not** use these Next.js cron routes; they authenticate via IAM/EventBridge and are unchanged by Phase 1A.1.

### Betting API authentication

Private `/api/betting/*` handlers call `requireBettingAuth` (`lib/auth/require-betting-auth.ts`), which reuses `resolveSupabaseAuth`. Unauthenticated callers receive `{ "error": "Unauthorized" }` with **401**. Page middleware still redirects `/betting/*` HTML routes to login; API protection does **not** rely on that redirect alone.

The public landing page does **not** call private betting APIs — featured games / props / trending previews use static demo data.

## 5. Domain and HTTPS

- Point DNS to Vercel (or your host) and enable HTTPS (default on Vercel).
- Update Supabase redirect URLs and any third-party OAuth redirect allowlists to use `https://`.

## 6. Optional hardening

- **Rate limits:** Supabase Auth rate limits; consider CAPTCHA for auth if you see abuse.
- **Monitoring:** Enable Vercel Analytics / Log Drains; watch 5xx and cron failures.

## 7. Build warnings you may see

- **Proxy:** Root `proxy.ts` replaces deprecated `middleware.ts` ([Next.js middleware → proxy](https://nextjs.org/docs/messages/middleware-to-proxy)). Session logic lives in `lib/supabase/middleware.ts` (`updateSession`).
- **`baseline-browser-mapping` is old** — optional devDependency update: `npm i baseline-browser-mapping@latest -D`.

## Quick post-launch smoke test

1. Open production `/` and `/betting`.
2. Sign up or log in (email + Google); confirm redirect and session.
3. Hit a DB-backed API (e.g. betting games) and confirm no 500s.
4. If you use cron settlement, confirm one successful cron execution in logs.
