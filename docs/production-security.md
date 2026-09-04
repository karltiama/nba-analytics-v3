# Production security (Phase 1)

Concise reference for auth, cron, destructive prune, and the offseason freeze. Operational deploy steps live in [deployment-checklist.md](./deployment-checklist.md).

## User / API auth

- **Pages** under `/betting/*`: session middleware (`proxy.ts` → `lib/supabase/middleware.ts`) redirects unauthenticated browsers to `/login`.
- **APIs** under `/api/betting/*`: handlers call `requireBettingAuth` → `resolveSupabaseAuth` (cookie session or `Authorization: Bearer`). Failure → **401** JSON `{ "error": "Unauthorized" }`. Do not rely on the HTML redirect for APIs.
- Same-origin browser `fetch('/api/betting/...')` sends cookies by default. Prefer `credentials: 'include'` when calling user profile/settings routes.
- **Logout**: `supabase.auth.signOut()` clears the session; subsequent `/betting` hits require login again.

## Cron auth

- Shared gate: `lib/auth/cron-auth.ts`.
- Production requires `CRON_SECRET` (or route-specific override where documented). Missing secret → **503**; bad/missing auth → **401**.
- Prefer `Authorization: Bearer <secret>`; `?secret=` is for manual checks only (can appear in logs).

## Destructive prune safeguards (`/api/cron/prune-props`)

Deletes are fail-closed. Destructive work requires **all** of:

1. Valid cron auth  
2. `PRUNE_ENABLED=1`  
3. `DATA_MODE=live_api`  
4. `OFFSEASON_MODE=0`  
5. `CRON_DRY_RUN=0`  
6. Archive verification (S3) before raw deletion  
7. Closing-line completeness before raw deletion  
8. Max-delete guard (percent/row caps; large deletes need `PRUNE_ALLOW_LARGE_DELETE=1`)

Missing or freeze-mode flags → skip / no deletes. Never treat missing `DATA_MODE` as live.

## Production freeze posture (current)

Until intentionally thawed for in-season ops:

| Variable | Production value |
|----------|------------------|
| `DATA_MODE` | `replay` |
| `OFFSEASON_MODE` | `1` |
| `CRON_DRY_RUN` | `1` |
| `PRUNE_ENABLED` | **unset** (do not set to `1`) |

Schedulers may still fire; jobs should no-op. Do not run a destructive prune to “test” safety.

## Secrets vs ordinary configuration

**Secrets** (never commit; rotate if exposed):

- `SUPABASE_DB_URL` (DB password in URI)
- `CRON_SECRET` / `PAPER_SETTLE_CRON_SECRET`
- `BALLDONTLIE_API_KEY` (and typo alias)
- AWS access keys / Terraform sensitive env maps
- Supabase **service role** key (if used)
- `OPENAI_API_KEY` and similar third-party keys

**Ordinary / public configuration** (safe in client or docs as placeholders):

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Freeze flags: `DATA_MODE`, `OFFSEASON_MODE`, `CRON_DRY_RUN`, `PRUNE_ENABLED`
- Season knobs: `CURRENT_ANALYTICS_SEASON`
- Bucket names / regions (`NBA_DATA_BUCKET`, `AWS_REGION`) when not paired with keys
- Placeholders in `.env.example` and `infra/terraform.tfvars.example`

Local Lambda secrets belong only in **untracked** `infra/terraform.tfvars` (`*.tfvars` is gitignored). Rotating a password at the provider does not update Vercel/Lambda until those env stores are updated to match.
