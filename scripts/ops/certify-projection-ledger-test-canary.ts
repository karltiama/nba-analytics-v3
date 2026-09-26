/**
 * End-to-end TEST ledger canary. Rolls back. Does not insert PROSPECTIVE_LIVE.
 *
 * Usage: npx tsx scripts/ops/certify-projection-ledger-test-canary.ts
 */
import 'dotenv/config';
import pg from 'pg';
import { computePropEvFields } from '@/lib/betting/player-prop-ev-row';
import { resolveEvTrack } from '@/lib/betting/ev-selection-policy';
import { getPlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';
import { buildLedgerMean, partitionSportsbookObservations } from '@/lib/betting/projection-ledger/compute';
import { projectionConfigFingerprint } from '@/lib/betting/projection-ledger/fingerprint';
import { LEDGER_V1_POLICY, LEDGER_V1_REVISION } from '@/lib/betting/projection-ledger/protocol';

async function main(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL?.trim();
  if (!connectionString) throw new Error('Missing SUPABASE_DB_URL');
  const pool = new pg.Pool({
    connectionString,
    ssl: connectionString.includes('supabase') ? { rejectUnauthorized: false } : undefined,
    max: 1,
  });
  const client = await pool.connect();
  const report: Record<string, unknown> = {
    provenance: 'TEST',
    prospectiveLiveInserted: false,
    rolledBack: false,
  };
  try {
    const game = await client.query<{
      game_id: string;
      season: string;
      start_time: Date;
      home_team_id: string;
    }>(
      `SELECT game_id, season::text AS season, start_time, home_team_id
         FROM analytics.games
        WHERE season = '2026' AND start_time IS NOT NULL
        ORDER BY start_time
        LIMIT 1`
    );
    const players = await client.query<{ player_id: string }>(
      `SELECT player_id::text AS player_id
         FROM analytics.player_season_averages
        WHERE season = '2025'
        ORDER BY player_id
        LIMIT 8`
    );
    if (!game.rows[0] || players.rows.length === 0) {
      throw new Error('canary fixtures missing');
    }
    const tip = new Date(game.rows[0].start_time).toISOString();
    let chosen: { playerId: string; mean: NonNullable<ReturnType<typeof buildLedgerMean>> } | null = null;
    for (const row of players.rows) {
      const inputs = await getPlayerPropModelInputs(row.player_id);
      const mean = inputs ? buildLedgerMean(inputs, 'points', resolveEvTrack()) : null;
      if (inputs && mean) {
        const served = computePropEvFields(
          {
            prop_type: 'points',
            market_type: 'over_under',
            side: 'over',
            line_value: 19.5,
            odds_american: -110,
            odds_decimal: 1.91,
          },
          inputs,
          resolveEvTrack()
        );
        if (served.projection !== mean.projectionValue) {
          throw new Error('serving projection diverged before insert');
        }
        chosen = { playerId: row.player_id, mean };
        report.projectionEqualsServing = true;
        report.inputSeasonKey = mean.inputSeasonKey;
        report.gameSeason = game.rows[0].season;
        break;
      }
    }
    if (!chosen) throw new Error('no production model inputs for the canary player sample');

    const generatedAt = new Date().toISOString();
    const books = await client.query<{
      sportsbook: string;
      side: string;
      line_value: string;
      odds_american: number;
      odds_decimal: string;
      implied_probability: string;
      snapshot_at: Date;
    }>(
      `SELECT sportsbook, lower(side) AS side, line_value::text, odds_american, odds_decimal::text,
              implied_probability::text, snapshot_at
         FROM analytics.player_props_current
        WHERE game_id::text = $1 AND player_id::text = $2 AND prop_type = 'points'
          AND lower(coalesce(market_type, '')) = 'over_under'
          AND lower(side) IN ('over', 'under')`,
      [game.rows[0].game_id, chosen.playerId]
    );
    const parts = partitionSportsbookObservations(
      books.rows.map((book) => ({ ...book, observedAt: new Date(book.snapshot_at).toISOString() })),
      generatedAt
    );

    await client.query('BEGIN');
    const inserted = await client.query<{ projection_snapshot_id: string; projection_value: string }>(
      `INSERT INTO analytics.projection_snapshots (
         game_id, player_id, team_id, season, input_season_key, market, snapshot_policy,
         snapshot_revision, provenance_type, timing_status, projection_value, base_projection_value,
         serving_track, projection_model_id, projection_model_version, calibration_version,
         code_revision, config_fingerprint, generated_at, intended_cutoff_at, game_tip_time,
         latest_input_game_start_time, l5_avg, l10_avg, season_avg, sample_games_used,
         season_games_played, sigma_effective, input_snapshot
       ) VALUES (
         $1,$2,$3,$4,$5,'points',$6,$7,'TEST','NOT_APPLICABLE',$8,$9,$10,$11,$12,$13,$14,$15,$16,
         $17::timestamptz - interval '60 minutes', $17,$18,$19,$20,$21,$22,$23,$24,$25::jsonb
       )
       RETURNING projection_snapshot_id, projection_value::text`,
      [
        game.rows[0].game_id,
        chosen.playerId,
        game.rows[0].home_team_id,
        game.rows[0].season,
        chosen.mean.inputSeasonKey,
        LEDGER_V1_POLICY,
        LEDGER_V1_REVISION,
        chosen.mean.projectionValue,
        chosen.mean.baseProjectionValue,
        resolveEvTrack(),
        chosen.mean.projectionModelId,
        chosen.mean.projectionModelVersion,
        chosen.mean.calibrationVersion,
        'test:phase3-canary',
        projectionConfigFingerprint(),
        generatedAt,
        tip,
        chosen.mean.latestInputGameStartTime,
        chosen.mean.l5Avg,
        chosen.mean.l10Avg,
        chosen.mean.seasonAvg,
        chosen.mean.sampleGamesUsed,
        chosen.mean.seasonGamesPlayed,
        chosen.mean.sigmaEffective,
        JSON.stringify(chosen.mean.inputSnapshot),
      ]
    );
    const snapshotId = inserted.rows[0]?.projection_snapshot_id;
    if (!snapshotId) throw new Error('test insert returned no id');
    report.storedMatchesServing = Number(inserted.rows[0]?.projection_value) === chosen.mean.projectionValue;
    if (report.storedMatchesServing !== true) throw new Error('stored projection diverged from serving');

    let marketChildren = 0;
    for (const book of parts.accepted) {
      if (book.observedAt > generatedAt) throw new Error('accepted a market observation after generated_at');
      await client.query(
        `INSERT INTO analytics.projection_market_snapshots (
           projection_snapshot_id, venue_type, sportsbook, side, line_value, odds_american,
           odds_decimal, market_implied_probability, observed_at, source_table
         ) VALUES ($1, 'sportsbook', $2, $3, $4, $5, $6, $7, $8, 'analytics.player_props_current')`,
        [
          snapshotId,
          book.sportsbook,
          book.side,
          book.line_value,
          book.odds_american,
          book.odds_decimal,
          book.implied_probability,
          book.observedAt,
        ]
      );
      marketChildren += 1;
    }
    report.marketChildren = marketChildren;
    report.marketRowsAvailable = books.rows.length;
    report.rejectedFutureObservations = parts.rejected.length;

    const visible = await client.query(
      `SELECT count(*)::text AS n FROM analytics.v_projection_performance WHERE projection_snapshot_id = $1`,
      [snapshotId]
    );
    report.officialViewRows = Number(visible.rows[0]?.n ?? '1');
    if (report.officialViewRows !== 0) throw new Error('TEST row appeared in the official view');

    await client.query('SAVEPOINT before_mutation');
    let updateRejected = false;
    try {
      await client.query(`UPDATE analytics.projection_snapshots SET projection_value = 0 WHERE projection_snapshot_id = $1`, [
        snapshotId,
      ]);
    } catch (error) {
      updateRejected = error instanceof Error && error.message.includes('append-only');
      await client.query('ROLLBACK TO SAVEPOINT before_mutation');
    }
    report.updateRejected = updateRejected;
    if (!updateRejected) throw new Error('TEST row accepted an update');

    await client.query('ROLLBACK');
    report.rolledBack = true;

    const counts = await client.query<{
      live: string;
      test_rows: string;
      backfill: string;
      snapshots: string;
      markets: string;
      attempts: string;
      official: string;
    }>(
      `SELECT
         (SELECT count(*) FROM analytics.projection_snapshots WHERE provenance_type = 'PROSPECTIVE_LIVE')::text AS live,
         (SELECT count(*) FROM analytics.projection_snapshots WHERE provenance_type = 'TEST')::text AS test_rows,
         (SELECT count(*) FROM analytics.projection_snapshots WHERE provenance_type = 'RECONSTRUCTED_BACKFILL')::text AS backfill,
         (SELECT count(*) FROM analytics.projection_snapshots)::text AS snapshots,
         (SELECT count(*) FROM analytics.projection_market_snapshots)::text AS markets,
         (SELECT count(*) FROM analytics.projection_publish_attempts)::text AS attempts,
         (SELECT count(*) FROM analytics.v_projection_performance)::text AS official`
    );
    report.counts = counts.rows[0];
    if (counts.rows[0]?.live !== '0' || counts.rows[0]?.snapshots !== '0') {
      throw new Error('canary left ledger rows behind');
    }
    console.log(JSON.stringify({ canary: 'PASS', ...report }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.log(JSON.stringify({ canary: 'FAIL', ...report, message: error instanceof Error ? error.message : 'unknown' }));
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
