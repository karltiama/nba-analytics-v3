/**
 * Manual BallDontLie active-roster collection.
 *
 *   npx tsx scripts/roster/collect-bdl-active-rosters.ts --season=2026-27 --dry-run
 *   npx tsx scripts/roster/collect-bdl-active-rosters.ts --season=2026-27 --apply
 *
 * --dry-run wins over --apply and writes nothing.
 * --apply writes one validated batch to raw.roster_observation_batches
 * and raw.roster_observation_members. It does not change stints or NBA.com snapshots.
 * There is no schedule. Do not import this file from a page.
 *
 * Phase 3G does not authorize running this command.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

import { getBalldontlieApiKeyFromEnv } from '../../lib/balldontlie/bdl-player-names-from-api';
import { fetchBdlLive } from '../../lib/balldontlie/live-rate-limit';
import {
  collectBdlActiveRoster,
  parseBdlRosterCollectArgs,
} from '../../lib/roster/bdl-active-roster';
import {
  decideBdlRosterPersistence,
  persistBdlRosterObservation,
  plannedBdlWriteTargets,
  previewBdlRosterWrite,
} from '../../lib/roster/bdl-roster-persist';

async function main(): Promise<void> {
  const parsed = parseBdlRosterCollectArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.message);
    process.exitCode = 1;
    return;
  }
  const apiKey = getBalldontlieApiKeyFromEnv();
  if (!apiKey) {
    console.error('BALLDONTLIE_API_KEY is not set');
    process.exitCode = 1;
    return;
  }
  const scopedEnv = {
    ...process.env,
    DATA_MODE: 'live_api',
    OFFSEASON_MODE: '0',
    CRON_DRY_RUN: '0',
    BDL_RATE_LIMIT_MAX_RETRIES: '0',
  };
  const collection = await collectBdlActiveRoster({
    seasonLabel: parsed.seasonLabel,
    maxRequests: parsed.maxRequests,
    transport: async (url) => {
      const response = await fetchBdlLive(
        url,
        { headers: { Authorization: apiKey } },
        { env: scopedEnv, worker: 'bdl-roster-observations' }
      );
      return {
        status: response.status,
        body: await response.json().catch(() => null),
        retryAfter: response.headers.get('retry-after'),
      };
    },
  });
  const decision = decideBdlRosterPersistence({ apply: parsed.apply, validationOk: collection.validation.ok });
  const preview = previewBdlRosterWrite({
    collectedAt: collection.observedAt ?? '',
    players: collection.players,
    decision,
  });
  const report = {
    provider: collection.provider,
    endpoint: collection.endpoint,
    season_label: collection.seasonLabel,
    observed_at: collection.observedAt,
    request_count: collection.requestCount,
    successful_pages: collection.successfulPages,
    player_count: collection.players.length,
    players: collection.players,
    team_counts: collection.teamCounts,
    pagination_complete: collection.paginationComplete,
    error: collection.error,
    validation: collection.validation,
    planned_write_targets: plannedBdlWriteTargets(decision),
    preview,
    writes: false,
  };
  const directory = path.join(process.cwd(), 'reports', 'roster');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `bdl-active-${collection.observedAt?.slice(0, 10) ?? 'undated'}.json`);
  if (!decision.write) {
    fs.writeFileSync(file, JSON.stringify({ ...report, persistence: decision.reason }, null, 2));
    console.log(JSON.stringify({ file, validation: collection.validation.ok, writes: false, targets: report.planned_write_targets }));
    if (!collection.validation.ok) process.exitCode = 1;
    return;
  }
  const databaseUrl = process.env.SUPABASE_DB_URL?.trim();
  if (!databaseUrl) {
    console.error('SUPABASE_DB_URL is not set');
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    const sizes = Object.values(collection.teamCounts);
    const result = await persistBdlRosterObservation(client, decision, {
      collectedAt: collection.observedAt ?? '',
      seasonLabel: collection.seasonLabel,
      requestCount: collection.requestCount,
      pageCount: collection.successfulPages,
      players: collection.players,
      minTeamSize: sizes.length ? Math.min(...sizes) : 0,
      maxTeamSize: sizes.length ? Math.max(...sizes) : 0,
    });
    fs.writeFileSync(file, JSON.stringify({ ...report, writes: result.written, persistence: result }, null, 2));
    console.log(JSON.stringify({ file, written: result.written, reason: result.reason, batch_id: result.batchId }));
    if (!result.written && result.reason !== 'already_stored') process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

if (process.argv[1]?.includes('collect-bdl-active-rosters')) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'roster collection failed';
    console.error(message);
    process.exitCode = 1;
  });
}
