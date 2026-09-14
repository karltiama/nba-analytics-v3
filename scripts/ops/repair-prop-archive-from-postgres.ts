/**
 * Rebuild a missing S3 archive from Postgres snapshot rows already stored
 * for one (pull_run_id, game_id). Does not re-fetch BDL.
 *
 * Default is dry-run. Use --execute to write S3 and update game_run metadata.
 *
 *   npx tsx scripts/ops/repair-prop-archive-from-postgres.ts --pull-run-id 12 --game-id 21717855
 *   npx tsx scripts/ops/repair-prop-archive-from-postgres.ts --pull-run-id 12 --game-id 21717855 --execute
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { archiveGameSnapshot } from '../../lambda/player-props-snapshot/src/archive-game';
import { completeGameRun } from '../../lambda/player-props-snapshot/src/bulk-writers';
import type { LambdaEnv } from '../../lambda/player-props-snapshot/src/env';
import type { NormalizedPropRow } from '../../lambda/player-props-snapshot/src/types';

function argValue(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  return argv[i + 1];
}

function requireArg(name: string): string {
  const v = argValue(name, process.argv)?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const pullRunId = Number(requireArg('--pull-run-id'));
  const gameId = requireArg('--game-id');
  if (!Number.isFinite(pullRunId) || pullRunId <= 0) {
    throw new Error('Invalid --pull-run-id');
  }

  const dbUrl = requireEnv('SUPABASE_DB_URL');
  const bucket = requireEnv('NBA_DATA_BUCKET');
  const pool = new Pool({ connectionString: dbUrl, max: 1 });
  try {
    const run = await pool.query<{
      pull_run_id: string | number;
      game_id: string;
      started_at: Date;
      rows_stored: string | number | null;
      archive_status: string | null;
      archive_key: string | null;
    }>(
      `SELECT pull_run_id, game_id, started_at, rows_stored, archive_status, archive_key
       FROM raw.player_prop_game_runs
       WHERE pull_run_id = $1 AND game_id = $2`,
      [pullRunId, gameId]
    );
    if (run.rows.length !== 1) {
      throw new Error(`Expected 1 game_run, found ${run.rows.length}`);
    }
    const gameRun = run.rows[0];
    const game = await pool.query<{
      season: string | null;
      start_time: Date | null;
    }>(
      `SELECT season::text AS season, start_time
       FROM analytics.games
       WHERE game_id::text = $1
       LIMIT 1`,
      [gameId]
    );
    const snaps = await pool.query<{
      game_id: number;
      player_id: number;
      player_name: string | null;
      team_id: number | null;
      sportsbook: string;
      prop_type: string;
      market_type: string;
      side: string;
      line_value: string | number | null;
      odds_american: number;
      odds_decimal: string | number;
      implied_probability: string | number;
      raw_json: unknown;
    }>(
      `SELECT game_id, player_id, player_name, team_id, sportsbook, prop_type, market_type, side,
              line_value, odds_american, odds_decimal, implied_probability, raw_json
       FROM raw.player_prop_snapshots_v2
       WHERE pull_run_id = $1 AND game_id = $2
       ORDER BY player_id, sportsbook, prop_type, side`,
      [pullRunId, Number(gameId)]
    );
    const normalized: NormalizedPropRow[] = snaps.rows.map((row) => ({
      game_id: Number(row.game_id),
      player_id: Number(row.player_id),
      player_name: row.player_name,
      team_id: row.team_id,
      sportsbook: row.sportsbook,
      prop_type: row.prop_type,
      market_type: row.market_type,
      side: row.side,
      line_value: row.line_value == null ? null : Number(row.line_value),
      odds_american: Number(row.odds_american),
      odds_decimal: Number(row.odds_decimal),
      implied_probability: Number(row.implied_probability),
      raw_json: row.raw_json,
      provider_updated_at: null,
    }));
    const snapshotAt = new Date(gameRun.started_at);
    const gameDate = snapshotAt.toISOString().slice(0, 10);
    const env: LambdaEnv = {
      dbUrl,
      apiKey: 'repair-does-not-call-bdl',
      preferredVendor: 'draftkings',
      storePropRawJson: false,
      propRawJsonSampleRate: 0,
      s3ArchiveEnabled: true,
      nbaDataBucket: bucket,
      nbaRawPrefix: (process.env.NBA_RAW_PREFIX || 'raw').trim(),
      awsRegion: process.env.AWS_REGION?.trim() || 'us-east-1',
    };

    const preview = {
      execute,
      pullRunId,
      gameId,
      startedAt: snapshotAt.toISOString(),
      rowsInPostgres: normalized.length,
      rowsStored: Number(gameRun.rows_stored ?? 0),
      currentArchiveStatus: gameRun.archive_status,
      currentArchiveKey: gameRun.archive_key,
      note: 'Writes the same idempotent key as the worker. Re-fetch via SQS redrive is not used.',
    };
    if (!execute) {
      console.log(JSON.stringify({ ...preview, wrote: false }, null, 2));
      return;
    }

    const archive = await archiveGameSnapshot({
      env,
      pullRunId,
      gameId,
      bdlGameId: Number(gameId),
      gameDate,
      snapshotAt,
      gameStartTime: game.rows[0]?.start_time ?? null,
      season: game.rows[0]?.season ?? null,
      opponentId: null,
      normalized,
      rowsStored: Number(gameRun.rows_stored ?? normalized.length),
    });
    await completeGameRun(
      pool,
      pullRunId,
      gameId,
      'success',
      normalized.length,
      Number(gameRun.rows_stored ?? normalized.length),
      undefined,
      {
        rowsArchived: archive.rowsArchived,
        archiveObjectCount: archive.archiveObjectCount,
        archiveStatus: archive.archiveStatus,
        archiveError: archive.archiveError,
        archiveKey: archive.archiveKey,
      }
    );
    console.log(JSON.stringify({ ...preview, wrote: true, archive }, null, 2));
    if (archive.archiveStatus !== 'archived') {
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
