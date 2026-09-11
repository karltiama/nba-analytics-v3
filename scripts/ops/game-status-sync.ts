/**
 * Dry-run frequent game status sync. Default: fixtures, no HTTP, no DB writes.
 *
 *   npx tsx scripts/ops/game-status-sync.ts --season=2026 --dry-run
 */

import 'dotenv/config';
import { PINNED_ANALYTICS_SEASON } from '@/lib/season';
import {
  createFixtureFetchPage,
  createMemoryGameStore,
  runGameStatusSync,
  shouldSkipGameStatusSync,
  type LocalGameRow,
  type ProviderGame,
} from '@/lib/games/status-sync';
import { planStatusSyncQuery, resolveStatusSyncTargetSeason } from '@/lib/games/status-sync-query';

const DEFAULT_FIXTURE: { local: LocalGameRow[]; provider: ProviderGame[] } = {
  local: [
    {
      gameId: '18450001',
      season: '2026',
      status: 'In Progress',
      startTime: '2026-10-22T23:30:00.000Z',
      homeTeamId: '13',
      awayTeamId: '14',
      homeScore: 90,
      awayScore: 88,
      venue: null,
    },
    {
      gameId: '18450002',
      season: '2025',
      status: 'Final',
      startTime: '2025-04-11T23:00:00.000Z',
      homeTeamId: '1',
      awayTeamId: '2',
      homeScore: 110,
      awayScore: 104,
      venue: null,
    },
  ],
  provider: [
    {
      id: 18450001,
      season: 2026,
      status: 'Final',
      datetime: '2026-10-22T23:30:00.000Z',
      date: '2026-10-22',
      home_team_score: 110,
      visitor_team_score: 104,
      home_team: { id: 13 },
      visitor_team: { id: 14 },
    },
    {
      id: 18449999,
      season: 2026,
      status: 'Scheduled',
      datetime: '2026-10-23T00:00:00.000Z',
      date: '2026-10-22',
      home_team_score: 0,
      visitor_team_score: 0,
      home_team: { id: 5 },
      visitor_team: { id: 6 },
    },
  ],
};

function argValue(flag: string): string | undefined {
  const prefix = `${flag}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main() {
  const season = argValue('--season') ? Number(argValue('--season')) : undefined;
  const http = process.argv.includes('--http');
  if (http) {
    console.error('Refusing --http in 13C.2; use fixtures. Live canary is a later controlled step.');
    process.exit(2);
  }

  const targetSeason = resolveStatusSyncTargetSeason(process.env, season);
  const plan = planStatusSyncQuery({
    targetSeason,
    now: new Date(),
    mode: 'frequent',
  });
  const result = await runGameStatusSync({
    env: process.env,
    targetSeason,
    dryRun: true,
    allowFrozenSimulation: true,
    store: createMemoryGameStore(DEFAULT_FIXTURE.local),
    fetchPage: createFixtureFetchPage(DEFAULT_FIXTURE.provider),
  });

  console.log(
    JSON.stringify(
      {
        job: result.job,
        status: result.status,
        targetSeason: result.targetSeason,
        productPin: PINNED_ANALYTICS_SEASON,
        frozen: shouldSkipGameStatusSync(process.env),
        query: {
          mode: plan.mode,
          startDate: plan.startDate,
          endDate: plan.endDate,
          path: plan.path,
        },
        gamesFetched: result.gamesFetched,
        inserted: result.inserted,
        updated: result.updated,
        unchanged: result.unchanged,
        rejected: result.rejected,
        statusChanges: result.statusChanges,
        became_final: result.becameFinal,
        final_preserved: result.finalPreserved,
        transitions: result.transitions,
        bdlHttp: 0,
        fixturePages: result.bdlHttp,
        wroteDb: result.wroteDb,
        dryRun: result.dryRun,
        printsSecrets: false,
      },
      null,
      2
    )
  );
}

void main();
