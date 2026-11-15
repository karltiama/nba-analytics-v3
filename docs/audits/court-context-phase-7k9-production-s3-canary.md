# Court Context Phase 7K.9 — production OIDC and historical-board S3 canary

Date: 2026-11-14. The temporary route was deployed, called once from the signed-in production session, and then removed. That call was rejected by the admin allowlist before AWS was contacted. Production archive retrieval stayed off. No board deletion and no VACUUM.

**Result: production OIDC was not demonstrated. The canary route is removed. NO-GO for archive activation. NO-GO for board deletion and compaction.**

## A. Executive verdict

`POST /api/admin/historical-board-canary` ran on production deployment `dpl_96zXQE6kT6rfQ9ymW5HewaVWW5dW`. The signed-in session received `403` `{ "error": "Forbidden" }`. The handler that calls STS and S3 did not run. A logged-out POST returned `401`. GET returned `404`. The route was then removed. `HISTORICAL_BOARD_ARCHIVE` stayed absent.

## B. Canary pull request and deployment

| Item | Value |
|---|---|
| Pull request | https://github.com/karltiama/nba-analytics-v3/pull/63 |
| Canary commit | `c344617cde8ca42cd61c013d2d40ffddbbef9f93` |
| Merge commit | `8efc50648800c2ff410e51f14f5e62f398152919` |
| Preview build | `dpl_BSGRwMmtw67GRruYBmyLzvvHfAFc`, target preview, Ready in 1m 19s |
| Production deployment | `dpl_96zXQE6kT6rfQ9ymW5HewaVWW5dW` |
| Production URL | `https://nba-analytics-v3-iqrmw9xy7-karltiamas-projects.vercel.app` |
| Production build | Ready in 1m 21s, created 2026-11-14 21:37:23 ET |
| Alias at call time | `courtcontext.com` |

The GitHub status on `8efc506` points at that production deployment. The pull request diff was the route, the report module, its test, this audit, and the exact `@aws-sdk/client-sts@3.1039.0` pin. The previous production deployment remains `dpl_Hu9HkXaQNy4FxjhLqGVwfV9DMgka`.

## C. Authentication

The call was a same-origin POST from `https://courtcontext.com/dashboard` with the existing signed-in session.

| Caller | Result |
|---|---|
| Signed-in production session | `403` `{ "error": "Forbidden" }` |
| Logged-out POST with `Origin: https://courtcontext.com` | `401` |
| GET, with or without a session | `404` |

`403` is the existing admin-allowlist response. It is returned before `runProductionCanary`, so this was not an STS failure and it was not retried. The response `Cache-Control` on that denial was `public, max-age=0, must-revalidate` because `requireAdminAuth` builds the `403` itself. The body contained no token, role ARN, or quote.

A second distinct non-admin account was not available. This signed-in session is the live non-admin proof.

## D. STS credential exchange

Not performed. The credential provider was not constructed.

## E. Assumed-role identity

Not available. No production `AssumeRoleWithWebIdentity` result was observed.

## F. S3 reads

The canary performed no S3 read. Before the deploy, the archive was still 14 objects and 2,213,050 bytes. Manifest checksum `HCG+Sr7GsW76Oywb59TCHsZbo+WAY5YMHUB0Z47P0wk=` and November 12 checksum `n6cVfQslgizNJwl/deGZnkzph2TSDyuvR4X0LJmJi/0=` matched the pinned SHA-256 values. After the call, the object count was still 14.

The local report test, against the backup directory rather than production OIDC, still produced manifest SHA-256 `1c21be4abec6b16efa3b2c1be7d4c21ec65ba3e58063960c1d4074678ecfd309`, November 12 SHA-256 `9fa7157d0b25822ccd27097f75e1999e4ce98764d20f2baf4785f42c99898bfd`, 11,934 rows, and 171,936 bytes. That local result is not production proof.

## G. Historical Last-5

Not run inside the production function. The local report test still saw 42 rebound consensus groups, no protected game `21718094` in the archive, no duplicate merged game, and no research-close substitution. The Remotion encoder was not run.

## H. Historical True Cost

Not run inside the production function. The local report test still kept saved price `-110`, found an opposite quote at the saved line, found no quote at the other line, and left a missing opposite empty.

## I. Current and open games

Today's Games was still rendered for the signed-in session immediately before the call. The archive flag stayed absent, so the shipped reader does not open S3 for the current date. The canary did not request a historical partition. Logged-out Props Explorer and Dashboard behavior was not re-walked after this `403`.

## J. Database size, same metrics as Phase 7J.1

| Metric | Phase 7J.1 after | This phase |
|---|---:|---:|
| `pg_database_size('postgres')` | 782,978,195 | 782,986,387 |
| `pg_database_size('template0')` | part of the template sum | 7,504,399 |
| `pg_database_size('template1')` | part of the template sum | 7,586,319 |
| Cluster sum | 798,068,913 | 798,077,105 |
| `pg_total_relation_size('analytics.player_props_current')` | unchanged relation recorded at 173,301,760 | 173,301,760 |
| Current board rows | 170,469 | 170,469 |
| Frozen candidate rows | 142,602 | 142,602 |

Phase 7K.8 reported 782,986,387 bytes as the cluster. That number is `pg_database_size('postgres')`. The three-database cluster is 798,077,105 bytes, which is 8,192 bytes above the Phase 7J.1 cluster. `postgres` grew by the same 8,192 bytes. The template sum is still 15,090,718 bytes. This is not a storage reduction. Snapshots remain 58,292, decision rows 181,980, and first-seen rows 87,894.

## K. Canary removal

[Pull request 64](https://github.com/karltiama/nba-analytics-v3/pull/64) merged as `5369d406d8a70a7c30b17379cd05e3c7f2875a19`. It deletes the route, the report module, its test, and `@aws-sdk/client-sts`. The historical-board reader from `4a8cd44` stays. `lib/props/historical-board-s3.ts` is still on `master`. No route file matches `historical-board-canary`.

The first production build of that merge, `dpl_w2ZwdHGMfvuvYSekFSCVt8vHd8CJ`, failed in 43 seconds on the existing Next.js Turbopack Google Fonts lookup in `components/content/context-check/instagram-fonts.ts`. The preview build of the same commit, `dpl_73B8KYxXu1DDZh4ibgLstLbTH9aA`, was Ready. One rebuild of that failed production deployment completed Ready as `dpl_7ytwLC2DfFbSHbNoGhjvA13vJ8yg` and is the deployment `courtcontext.com` serves. No application source changed between the failure and the rebuild.

## L. Endpoint after removal

On `dpl_7ytwLC2DfFbSHbNoGhjvA13vJ8yg`:

| Request | Status |
|---|---|
| `GET /api/admin/historical-board-canary` | 404 |
| `POST /api/admin/historical-board-canary` | 404 |
| `GET /` | 200 |

Today's Games still rendered DEN/NOP, DAL/CLE, DET/MIA, BKN/MEM, and CHI/MIN after this deployment.

## M. Archive flag

`HISTORICAL_BOARD_ARCHIVE` was absent from the production environment name list before the canary and was not changed. The route refuses to continue when that source mode is anything other than off. Preview remains separately configured. No static `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, or `AWS_SESSION_TOKEN` is present. Production `AWS_ROLE_ARN` and `AWS_REGION` are still the only AWS entries. Their decrypted values were not pulled again in this phase because a production env pull also contains secrets. The route compares `AWS_ROLE_ARN` to the production role before it would call STS. That comparison did not run.

The production trust policy is still one statement: `aud` `https://vercel.com/karltiamas-projects` and subject `owner:karltiamas-projects:project:nba-analytics-v3:environment:production`. The role policy is still only `s3:GetObject` on the approved archive prefix. No deployment-protection bypass was created.

## N. Archive activation

**NO-GO.** A production function did not assume `court-context-historical-board-read-production` and did not read the archive. Local administrator credentials were not used as a substitute.

## O. Board deletion and compaction

**NO-GO.** Do not delete or compact `analytics.player_props_current`. Do not run VACUUM or VACUUM FULL. Frozen operation `a8aca536-5078-454e-a367-a497b9abd6f6` was not resumed.

## P. Writes

No PostgreSQL mutation, no S3 write, and no IAM or AWS infrastructure change. The SQL in this phase was `SELECT` only. The application changes are the canary merge and its removal.
