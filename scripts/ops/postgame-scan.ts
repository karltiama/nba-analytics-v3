/**
 * Dry-run postgame Final scanner. Read-only. No BDL HTTP. No SQS SendMessage. No stage workers.
 *
 *   npx tsx scripts/ops/postgame-scan.ts
 *   npx tsx scripts/ops/postgame-scan.ts --season=2026 --lookback-hours=36
 */

import 'dotenv/config';
import { query } from '@/lib/db';
import { readIngestionMode } from '@/lib/runtime/ingestion-mode';
import { scanPostgameFinals, type PostgameScanGame, type PostgameStage, type PostgameStageRow } from '@/lib/postgame';
import { POSTGAME_STAGES, type PostgameReasonCode, type PostgameStageStatus } from '@/lib/postgame/types';

function argValue(flag: string): string | undefined {
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('-')) return process.argv[i + 1];
  return undefined;
}

function isStage(value: string): value is PostgameStage {
  return (POSTGAME_STAGES as readonly string[]).includes(value);
}

function isStatus(value: string): value is PostgameStageStatus {
  return [
    'WAITING',
    'QUEUED',
    'RUNNING',
    'READY',
    'BLOCKED',
    'EXPECTED_ABSENCE',
    'FAILED',
  ].includes(value);
}

async function main() {
  const season = argValue('--season') ?? '2026';
  const lookbackHours = Number(argValue('--lookback-hours') ?? '36');
  const mode = readIngestionMode();
  const liveIngestionEnabled = process.env.LIVE_INGESTION_ENABLED === 'true' || process.env.LIVE_INGESTION_ENABLED === '1';
  const goatSubscriptionActive =
    process.env.BDL_GOAT_SUBSCRIPTION === '1' || process.env.BDL_GOAT_SUBSCRIPTION === 'true';

  let games: PostgameScanGame[] = [];
  try {
    const rows = await query<{
      game_id: string;
      season: string;
      status: string | null;
      home_score: number | null;
      away_score: number | null;
      start_time: Date | string | null;
    }>(
      `SELECT game_id, season, status, home_score, away_score, start_time
       FROM analytics.games
       WHERE season = $1`,
      [season]
    );
    games = rows.map((row) => ({
      gameId: row.game_id,
      season: row.season,
      status: row.status ?? '',
      homeScore: row.home_score,
      awayScore: row.away_score,
      startTime: row.start_time ? new Date(row.start_time).toISOString() : null,
    }));
  } catch (err) {
    console.error('[postgame-scan] games unread:', err instanceof Error ? err.message : err);
  }

  let stages: PostgameStageRow[] = [];
  try {
    const rows = await query<{
      game_id: string;
      season: string;
      stage: string;
      status: string;
      attempts: number;
      reason_code: string | null;
      updated_at: Date | string;
    }>(
      `SELECT game_id, season, stage, status, attempts, reason_code, updated_at
       FROM analytics.postgame_game_stages
       WHERE season = $1`,
      [season]
    );
    stages = rows.flatMap((row) => {
      if (!isStage(row.stage) || !isStatus(row.status)) return [];
      return [
        {
          gameId: row.game_id,
          season: row.season,
          stage: row.stage,
          status: row.status,
          attempts: Number(row.attempts) || 0,
          reasonCode: (row.reason_code as PostgameReasonCode | null) ?? null,
          updatedAt: new Date(row.updated_at).toISOString(),
        },
      ];
    });
  } catch {
    stages = [];
  }

  const result = scanPostgameFinals({
    games,
    stages,
    evidence: [],
    config: {
      now: new Date(),
      lookbackHours: Number.isFinite(lookbackHours) ? lookbackHours : 36,
      season,
      liveIngestionEnabled,
      freezeSkipsMutations: mode.shouldSkipMutations,
      goatSubscriptionActive,
    },
  });

  const enqueueHold = result.enqueue.filter((e) => e.action === 'hold').length;
  const enqueueSend = result.enqueue.filter((e) => e.action === 'enqueue').length;

  console.log(
    JSON.stringify(
      {
        dryRun: true,
        sentSqs: 0,
        wroteStages: 0,
        bdlHttp: 0,
        season,
        lookbackHours,
        freeze: {
          dataMode: mode.dataMode,
          skipMutations: mode.shouldSkipMutations,
          liveIngestionEnabled,
          goatSubscriptionActive,
        },
        scannedGames: result.scannedGames,
        eligibleFinals: result.eligibleFinals,
        skippedNonFinal: result.skippedNonFinal,
        skippedOutsideLookback: result.skippedOutsideLookback,
        skippedWrongSeason: result.skippedWrongSeason,
        plannedUpserts: result.upserts.length,
        enqueueHold,
        enqueueSend,
        sample: result.enqueue.slice(0, 8).map((e) => ({
          action: e.action,
          holdReason: e.holdReason ?? null,
          gameId: e.message.gameId,
          stage: e.message.stage,
          attempt: e.message.attempt,
        })),
      },
      null,
      2
    )
  );
}

void main();
