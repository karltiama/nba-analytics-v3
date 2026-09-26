/**
 * T−60 publish cycle. Inserts parents and sportsbook children in one transaction.
 * Writes nothing unless the caller has already passed the writes gate.
 */

import type { Pool, PoolClient } from 'pg';
import { resolveEvTrack } from '@/lib/betting/ev-selection-policy';
import { getPlayerPropModelInputs } from '@/lib/betting/player-prop-inputs';
import { buildLedgerMean, partitionSportsbookObservations, servedSideForLine } from '@/lib/betting/projection-ledger/compute';
import { projectionConfigFingerprint } from '@/lib/betting/projection-ledger/fingerprint';
import { gameEligibleForLedgerPublish, type LedgerGameCandidate } from '@/lib/betting/projection-ledger/eligibility';
import { classifyDuplicate, decideLedgerWrite, type AttemptOutcome } from '@/lib/betting/projection-ledger/idempotency';
import {
  LEDGER_MARKETS,
  LEDGER_V1_POLICY,
  LEDGER_V1_REVISION,
  PROJECTION_LEDGER_GIT_SHA_ENV,
} from '@/lib/betting/projection-ledger/protocol';
import { isProductionGitSha } from '@/lib/betting/projection-ledger/revision';
import { classifyLedgerCapture } from '@/lib/betting/projection-ledger/timing';

export interface CycleSummary {
  gamesSeen: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  errors: number;
}

interface MarketRow {
  id: string;
  sportsbook: string;
  side: string;
  line_value: string;
  odds_american: number;
  odds_decimal: string;
  implied_probability: string;
  snapshot_at: Date | string;
}

async function logAttempt(
  client: PoolClient,
  row: {
    gameId?: string | null;
    playerId?: string | null;
    market?: string | null;
    outcome: AttemptOutcome;
    detail?: Record<string, unknown>;
    codeRevision?: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO analytics.projection_publish_attempts
       (game_id, player_id, market, snapshot_policy, provenance_type, outcome, detail, code_revision)
     VALUES ($1, $2, $3, $4, 'PROSPECTIVE_LIVE', $5, $6::jsonb, $7)`,
    [
      row.gameId ?? null,
      row.playerId ?? null,
      row.market ?? null,
      LEDGER_V1_POLICY,
      row.outcome,
      JSON.stringify(row.detail ?? {}),
      row.codeRevision ?? null,
    ]
  );
}

async function loadUpcomingGames(client: PoolClient, nowIso: string): Promise<LedgerGameCandidate[]> {
  const res = await client.query(
    `SELECT game_id::text AS game_id, season::text AS season, start_time, status,
            home_team_id::text AS home_team_id, away_team_id::text AS away_team_id
       FROM analytics.games
      WHERE start_time IS NOT NULL
        AND start_time > $1::timestamptz
        AND start_time <= $1::timestamptz + interval '48 hours'`,
    [nowIso]
  );
  return res.rows.map((row) => ({
    gameId: String(row.game_id),
    season: String(row.season),
    startTime: new Date(row.start_time as string).toISOString(),
    status: row.status == null ? null : String(row.status),
    homeTeamId: String(row.home_team_id),
    awayTeamId: String(row.away_team_id),
  }));
}

async function loadPlayers(client: PoolClient, game: LedgerGameCandidate, cutoffIso: string): Promise<Array<{ playerId: string; teamId: string | null }>> {
  const res = await client.query(
    `SELECT player_id, team_id FROM (
       SELECT DISTINCT ON (l.player_id) l.player_id::text AS player_id, l.team_id::text AS team_id
         FROM analytics.player_game_logs l
         JOIN analytics.games g ON g.game_id = l.game_id
        WHERE l.team_id IN ($1, $2)
          AND COALESCE(g.start_time, l.game_date::timestamptz) < $3::timestamptz
        ORDER BY l.player_id, COALESCE(g.start_time, l.game_date::timestamptz) DESC
       UNION
       SELECT DISTINCT player_id::text, NULLIF(team_id::text, '')
         FROM analytics.player_props_current
        WHERE game_id::text = $4
     ) s`,
    [game.homeTeamId, game.awayTeamId, cutoffIso, game.gameId]
  );
  const seen = new Map<string, string | null>();
  for (const row of res.rows) {
    const playerId = String(row.player_id);
    if (!seen.has(playerId)) seen.set(playerId, row.team_id == null ? null : String(row.team_id));
  }
  return [...seen.entries()].map(([playerId, teamId]) => ({ playerId, teamId }));
}

async function loadMarkets(client: PoolClient, gameId: string, playerId: string, market: string): Promise<MarketRow[]> {
  const res = await client.query(
    `SELECT id::text, sportsbook, lower(side) AS side, line_value, odds_american, odds_decimal,
            implied_probability, snapshot_at
       FROM analytics.player_props_current
      WHERE game_id::text = $1
        AND player_id::text = $2
        AND prop_type = $3
        AND lower(coalesce(market_type, '')) = 'over_under'
        AND lower(side) IN ('over', 'under')`,
    [gameId, playerId, market]
  );
  return res.rows as MarketRow[];
}

export async function runProjectionLedgerCycle(pool: Pool, now = new Date()): Promise<CycleSummary> {
  const summary: CycleSummary = { gamesSeen: 0, inserted: 0, duplicates: 0, skipped: 0, errors: 0 };
  const codeRevision = (process.env[PROJECTION_LEDGER_GIT_SHA_ENV] ?? '').trim();
  const fingerprint = projectionConfigFingerprint();
  const servingTrack = resolveEvTrack();
  const client = await pool.connect();
  try {
    const games = await loadUpcomingGames(client, now.toISOString());
    summary.gamesSeen = games.length;
    if (!isProductionGitSha(codeRevision)) {
      await logAttempt(client, {
        outcome: 'skipped_missing_code_revision',
        detail: { games: games.length },
      });
      summary.skipped += 1;
      return summary;
    }

    for (const game of games) {
      if (!gameEligibleForLedgerPublish(game)) {
        await logAttempt(client, {
          gameId: game.gameId,
          outcome: 'skipped_ineligible_game',
          codeRevision,
          detail: { status: game.status, startTime: game.startTime },
        });
        summary.skipped += 1;
        continue;
      }
      const timing = classifyLedgerCapture({ gameTipTime: game.startTime, generatedAt: now.toISOString() });
      if (!timing.accept) {
        await logAttempt(client, {
          gameId: game.gameId,
          outcome: timing.reason === 'after_tip' ? 'skipped_after_tip' : 'skipped_not_due',
          codeRevision,
          detail: { reason: timing.reason, startTime: game.startTime },
        });
        summary.skipped += 1;
        continue;
      }

      const players = await loadPlayers(client, game, timing.intendedCutoffAt);
      for (const player of players) {
        const inputs = await getPlayerPropModelInputs(player.playerId);
        for (const market of LEDGER_MARKETS) {
          const decision = decideLedgerWrite({
            codeRevision,
            gameEligible: true,
            timing,
            inputsPresent: inputs != null,
            market,
          });
          if (decision !== 'write' || !inputs) {
            await logAttempt(client, {
              gameId: game.gameId,
              playerId: player.playerId,
              market,
              outcome: decision === 'write' ? 'skipped_no_inputs' : decision,
              codeRevision,
            });
            summary.skipped += 1;
            continue;
          }
          const mean = buildLedgerMean(inputs, market, servingTrack);
          if (!mean || mean.latestInputGameStartTime == null) {
            await logAttempt(client, {
              gameId: game.gameId,
              playerId: player.playerId,
              market,
              outcome: 'skipped_no_inputs',
              codeRevision,
            });
            summary.skipped += 1;
            continue;
          }

          await client.query('BEGIN');
          try {
            const inserted = await client.query(
              `INSERT INTO analytics.projection_snapshots (
                 game_id, player_id, team_id, season, input_season_key, market, snapshot_policy,
                 snapshot_revision, provenance_type, timing_status, projection_value, base_projection_value,
                 serving_track, projection_model_id, projection_model_version, calibration_version,
                 code_revision, config_fingerprint, generated_at, intended_cutoff_at, game_tip_time,
                 latest_input_game_start_time, l5_avg, l10_avg, season_avg, sample_games_used,
                 season_games_played, sigma_effective, input_snapshot
               ) VALUES (
                 $1,$2,$3,$4,$5,$6,$7,$8,'PROSPECTIVE_LIVE',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb
               )
               ON CONFLICT (game_id, player_id, market, snapshot_policy, provenance_type, snapshot_revision)
               DO NOTHING
               RETURNING projection_snapshot_id`,
              [
                game.gameId,
                player.playerId,
                player.teamId,
                game.season,
                mean.inputSeasonKey,
                market,
                LEDGER_V1_POLICY,
                LEDGER_V1_REVISION,
                timing.timingStatus,
                mean.projectionValue,
                mean.baseProjectionValue,
                servingTrack,
                mean.projectionModelId,
                mean.projectionModelVersion,
                mean.calibrationVersion,
                codeRevision,
                fingerprint,
                now.toISOString(),
                timing.intendedCutoffAt,
                game.startTime,
                mean.latestInputGameStartTime,
                mean.l5Avg,
                mean.l10Avg,
                mean.seasonAvg,
                mean.sampleGamesUsed,
                mean.seasonGamesPlayed,
                mean.sigmaEffective,
                JSON.stringify(mean.inputSnapshot),
              ]
            );

            if (inserted.rows.length === 0) {
              const existing = await client.query(
                `SELECT projection_value, code_revision
                   FROM analytics.projection_snapshots
                  WHERE game_id = $1 AND player_id = $2 AND market = $3
                    AND snapshot_policy = $4 AND provenance_type = 'PROSPECTIVE_LIVE'
                    AND snapshot_revision = $5`,
                [game.gameId, player.playerId, market, LEDGER_V1_POLICY, LEDGER_V1_REVISION]
              );
              const prior = existing.rows[0];
              const outcome = prior
                ? classifyDuplicate(
                    {
                      identity: {
                        gameId: game.gameId,
                        playerId: player.playerId,
                        market,
                        snapshotPolicy: LEDGER_V1_POLICY,
                        provenanceType: 'PROSPECTIVE_LIVE',
                        snapshotRevision: LEDGER_V1_REVISION,
                      },
                      projectionValue: Number(prior.projection_value),
                      codeRevision: String(prior.code_revision),
                    },
                    mean.projectionValue,
                    codeRevision
                  )
                : 'duplicate_conflict';
              await logAttempt(client, {
                gameId: game.gameId,
                playerId: player.playerId,
                market,
                outcome,
                codeRevision,
                detail: { recomputed: mean.projectionValue, stored: prior ? Number(prior.projection_value) : null },
              });
              await client.query('COMMIT');
              summary.duplicates += 1;
              continue;
            }

            const snapshotId = String(inserted.rows[0].projection_snapshot_id);
            const markets = await loadMarkets(client, game.gameId, player.playerId, market);
            const observed = markets.map((book) => ({
              ...book,
              observedAt: new Date(book.snapshot_at).toISOString(),
            }));
            const parts = partitionSportsbookObservations(observed, now.toISOString());
            for (const book of parts.rejected) {
              await logAttempt(client, {
                gameId: game.gameId,
                playerId: player.playerId,
                market,
                outcome: 'market_child_rejected',
                codeRevision,
                detail: { sportsbook: book.sportsbook, side: book.side, observedAt: book.observedAt },
              });
            }
            for (const book of parts.accepted) {
              const served = servedSideForLine(inputs, market, servingTrack, {
                prop_type: market,
                market_type: 'over_under',
                side: book.side,
                line_value: Number(book.line_value),
                odds_american: book.odds_american,
                odds_decimal: Number(book.odds_decimal),
              });
              if (!served || served.projectionValue !== mean.projectionValue) {
                await logAttempt(client, {
                  gameId: game.gameId,
                  playerId: player.playerId,
                  market,
                  outcome: 'market_child_rejected',
                  codeRevision,
                  detail: { sportsbook: book.sportsbook, side: book.side, reason: 'serving_mean_mismatch' },
                });
                continue;
              }
              await client.query(
                `INSERT INTO analytics.projection_market_snapshots (
                   projection_snapshot_id, venue_type, sportsbook, side, line_value, odds_american,
                   odds_decimal, market_implied_probability, observed_at, source_table, source_row_id,
                   served_probability_raw, served_probability_calibrated, served_probability_anchored, served_ev
                 ) VALUES (
                   $1, 'sportsbook', $2, $3, $4, $5, $6, $7, $8, 'analytics.player_props_current', $9, $10, $11, $12, $13
                 )`,
                [
                  snapshotId,
                  book.sportsbook,
                  book.side,
                  book.line_value,
                  book.odds_american,
                  book.odds_decimal,
                  book.implied_probability,
                  book.observedAt,
                  book.id,
                  served.servedProbabilityRaw,
                  served.servedProbabilityCalibrated,
                  served.servedProbabilityAnchored,
                  served.servedEv,
                ]
              );
            }
            await logAttempt(client, {
              gameId: game.gameId,
              playerId: player.playerId,
              market,
              outcome: 'inserted',
              codeRevision,
              detail: { timing: timing.timingStatus, inputSeasonKey: mean.inputSeasonKey, gameSeason: game.season },
            });
            await client.query('COMMIT');
            summary.inserted += 1;
          } catch (error) {
            await client.query('ROLLBACK');
            await logAttempt(client, {
              gameId: game.gameId,
              playerId: player.playerId,
              market,
              outcome: 'error',
              codeRevision,
              detail: { message: error instanceof Error ? error.message : 'unknown' },
            });
            summary.errors += 1;
          }
        }
      }
    }
    console.log(JSON.stringify({ event: 'projection_ledger_cycle', ...summary }));
    return summary;
  } finally {
    client.release();
  }
}
