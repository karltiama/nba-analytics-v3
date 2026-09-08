import { describe, expect, it } from 'vitest';
import { planAdvancedStatsV2Archive } from '@/lib/archive/advanced-stats-v2';
import { planLineups2025Archive } from '@/lib/archive/lineups-2025';
import { planOpeningGameOddsArchive } from '@/lib/archive/opening-game-odds';
import { MATCHABILITY_KEYS, planOpeningPlayerPropsArchive } from '@/lib/archive/opening-player-props';
import {
  DO_NOT_TOUCH_LOCAL_ONLY_ID,
  GAMES_ONLY_MISSING_IDS,
  GAMES_ONLY_REPAIR_IDS,
  GAMES_ONLY_STALE_IDS,
  goatStatsRepairCount,
  GOAT_STATS_REPAIR_IDS,
} from '@/lib/ingestion/goat-stats-repair-queue';
import { planGamesOnlyRepair, type CachedBdlGame } from '@/lib/ingestion/repair-2025-games';
import { runHistoricalServingBackfill } from '@/lib/ingestion/historical-serving/orchestrate';

function bdlGame(id: number, over: Partial<CachedBdlGame> = {}): CachedBdlGame {
  return {
    id,
    date: '2026-05-10',
    datetime: '2026-05-10T23:00:00.000Z',
    season: 2025,
    status: 'Final',
    home_team_score: 100,
    visitor_team_score: 90,
    home_team: { id: 1 },
    visitor_team: { id: 2 },
    ...over,
  };
}

describe('historical orchestrator dry-run', () => {
  it('plans 2024 without probing paid endpoints', async () => {
    const logs: string[] = [];
    const r = await runHistoricalServingBackfill(['--season=2024', '--dry-run'], (m) => logs.push(m));
    expect(r.exitCode).toBe(0);
    expect(r.dryRun).toBe(true);
    expect(logs.join('\n')).toMatch(/stagingMode\s+: none/);
    expect(logs.join('\n')).toMatch(/skip provider probe/);
    expect(logs.join('\n')).toMatch(/transformBdlArchiveToServing/);
  });

  it('plans 2023 the same way', async () => {
    const r = await runHistoricalServingBackfill(['--season=2023', '--dry-run']);
    expect(r).toEqual({ exitCode: 0, dryRun: true, season: 2023 });
  });
});

describe('GOAT stats queue', () => {
  it('keeps 34 /v1/stats IDs and does not include the score-only game', () => {
    expect(goatStatsRepairCount()).toBe(34);
    expect(GOAT_STATS_REPAIR_IDS).toHaveLength(34);
    expect(GOAT_STATS_REPAIR_IDS).not.toContain(18446941);
    expect(GOAT_STATS_REPAIR_IDS).not.toContain(DO_NOT_TOUCH_LOCAL_ONLY_ID);
  });
});

describe('games-only repair plan', () => {
  it('proposes inserts/updates for the known allowlist and never touches 21681993', () => {
    const bdlGames = GAMES_ONLY_REPAIR_IDS.map((id) =>
      bdlGame(id, id === 18446941 ? { home_team_score: 115, visitor_team_score: 148 } : {})
    );
    const plan = planGamesOnlyRepair({
      bdlGames,
      localGames: [
        {
          game_id: String(DO_NOT_TOUCH_LOCAL_ONLY_ID),
          season: '2025',
          status: '2026-04-30T04:00:00Z',
          home_team_id: '1',
          away_team_id: '2',
          home_score: 0,
          away_score: 0,
          start_time: '2026-04-30T04:00:00Z',
        },
        {
          game_id: String(GAMES_ONLY_STALE_IDS[0]),
          season: '2025',
          status: '1st Qtr',
          home_team_id: '1',
          away_team_id: '2',
          home_score: 0,
          away_score: 0,
          start_time: null,
        },
        {
          game_id: '18446941',
          season: '2025',
          status: 'Final',
          home_team_id: '30',
          away_team_id: '6',
          home_score: 114,
          away_score: 148,
          start_time: '2025-11-08T00:00:00.000Z',
        },
      ],
    });
    expect(plan.statsCalls).toBe(0);
    expect(plan.mutations).toHaveLength(GAMES_ONLY_REPAIR_IDS.length);
    expect(plan.mutations.filter((m) => m.reason === 'missing_analytics_game')).toHaveLength(
      GAMES_ONLY_MISSING_IDS.length
    );
    expect(plan.mutations.some((m) => m.gameId === String(DO_NOT_TOUCH_LOCAL_ONLY_ID))).toBe(false);
    expect(plan.skipped.some((s) => s.gameId === String(DO_NOT_TOUCH_LOCAL_ONLY_ID))).toBe(true);
    const score = plan.mutations.find((m) => m.reason === 'score_correction');
    expect(score?.to.home_score).toBe(115);
    expect(score?.from?.home_score).toBe(114);
  });
});

describe('trial archive job plans', () => {
  it('prepares all four jobs as dry-run with no postgres materialize', () => {
    expect(planAdvancedStatsV2Archive(['--season=2024', '--dry-run']).postgresMaterialize).toBe(false);
    expect(planAdvancedStatsV2Archive(['--season=2024']).endpoint).toContain('period=0');
    expect(planOpeningPlayerPropsArchive({ argv: ['--dry-run'], gameIds: ['1', '2'] }).estimatedRequests).toBe(2);
    expect(MATCHABILITY_KEYS).toEqual(['game_id', 'player_id', 'vendor', 'prop_type']);
    expect(planOpeningGameOddsArchive(['--season=2023', '--dry-run']).kind).toBe('opening_game_odds');
    expect(planLineups2025Archive(['a', 'b', 'c']).estimatedRequests).toBe(3);
  });
});
