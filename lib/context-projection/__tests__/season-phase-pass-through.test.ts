/**
 * DATA2E.1P — analytics.games.season_phase flows from the three prospective loaders
 * into the single eligibility rule (seasonPhaseExclusionReason). No network, no DB.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  default: { query: vi.fn() },
}));

import {
  classifyProspectiveCompetition,
  isPrimaryProspectiveCompetitionGame,
  seasonPhaseExclusionReason,
} from '@/lib/context-projection/game-universe';
import { loadProspectiveUpcomingGames } from '@/lib/context-projection/collection-candidates';
import { loadUpcomingGames as loadLedgerGames } from '@/lib/betting/projection-ledger/cycle';
import { gameEligibleForLedgerPublish } from '@/lib/betting/projection-ledger/eligibility';
import { loadUpcomingGames as loadShadowGames } from '@/lib/betting/player-projection-shadow-store';
import { runShadowScoreCycle } from '@/lib/betting/player-projection-shadow-worker';
import { ANALYTICS_GAMES_FINAL_PRESERVE_UPSERT_SQL } from '@/lib/betting/final-preserve';
import { APPLY_SEASON_PHASE_SQL } from '@/lib/games/status-sync-db';
import { classifySeasonPhase } from '@/lib/games/season-phase';
import type { SqlQueryable } from '@/lib/db/schema-capability';

const IN_SEASON_TIP = '2026-11-05T00:00:00.000Z';
const PLAYOFF_TIP = '2026-04-20T00:00:00.000Z';

type Row = Record<string, unknown>;

function gameRow(gameId: string, seasonPhase: string | null, startTime = IN_SEASON_TIP, season = '2026'): Row {
  return {
    game_id: gameId,
    season,
    start_time: startTime,
    home_team_id: '1',
    away_team_id: '2',
    status: 'Scheduled',
    season_phase: seasonPhase,
  };
}

/** Fake pg client: answers the season_phase column probe and the games select; records SQL. */
function fakeDb(opts: { hasPhaseColumn: boolean; games: Row[] }) {
  const sql: string[] = [];
  const db: SqlQueryable = {
    async query(text: string) {
      sql.push(text);
      if (text.includes('to_regclass')) return { rows: [{ rel: 'present' }] };
      if (text.includes('information_schema.columns')) {
        return { rows: opts.hasPhaseColumn ? [{ ok: 1 }] : [] };
      }
      if (/FROM analytics\.games\b/.test(text) && !/JOIN/.test(text)) return { rows: opts.games };
      return { rows: [] };
    },
  };
  return { db, sql };
}

const MATRIX: Array<[string, boolean]> = [
  ['PRESEASON', false],
  ['UNCLASSIFIED', false],
  ['REGULAR', true],
  ['IST', true],
  ['PLAYIN', true],
  ['PLAYOFFS', true],
];

describe('eligibility matrix (in-season date, frozen prospective-game-universe-v1)', () => {
  it.each(MATRIX)('%s → primary eligible = %s', (phase, eligible) => {
    const opts = { season: '2026', startTimeIso: IN_SEASON_TIP, status: 'Scheduled', seasonPhase: phase };
    expect(isPrimaryProspectiveCompetitionGame(opts)).toBe(eligible);
    expect(
      gameEligibleForLedgerPublish({
        gameId: 'g',
        season: '2026',
        startTime: IN_SEASON_TIP,
        status: 'Scheduled',
        homeTeamId: '1',
        awayTeamId: '2',
        seasonPhase: phase,
      })
    ).toBe(eligible);
    expect(seasonPhaseExclusionReason(phase) == null).toBe(eligible);
  });

  it('PLAYIN / PLAYOFFS on a postseason date stay eligible under the v1 date rules', () => {
    for (const seasonPhase of ['PLAYIN', 'PLAYOFFS']) {
      const c = classifyProspectiveCompetition({ season: '2025', startTimeIso: PLAYOFF_TIP, status: 'Scheduled', seasonPhase });
      expect(c).toMatchObject({ class: 'PLAY_IN_OR_PLAYOFFS', primaryEligible: true });
    }
  });

  it('REGULAR still obeys every existing rule (cancelled, pre-open date, unknown season)', () => {
    const base = { season: '2026', startTimeIso: IN_SEASON_TIP, seasonPhase: 'REGULAR' };
    expect(isPrimaryProspectiveCompetitionGame({ ...base, status: 'Cancelled' })).toBe(false);
    expect(isPrimaryProspectiveCompetitionGame({ ...base, startTimeIso: '2026-10-10T23:00:00.000Z' })).toBe(false);
    expect(isPrimaryProspectiveCompetitionGame({ ...base, season: '2031' })).toBe(false);
  });

  it('legacy row: UNCLASSIFIED inside the season date range never enters the cohort', () => {
    const dates = ['2026-10-20T23:00:00.000Z', IN_SEASON_TIP, '2027-01-15T01:00:00.000Z', '2027-03-30T23:00:00.000Z'];
    for (const startTimeIso of dates) {
      expect(isPrimaryProspectiveCompetitionGame({ season: '2026', startTimeIso, status: 'Scheduled' })).toBe(true);
      expect(
        isPrimaryProspectiveCompetitionGame({ season: '2026', startTimeIso, status: 'Scheduled', seasonPhase: 'UNCLASSIFIED' })
      ).toBe(false);
    }
  });

  it('missing / malformed values resolve to excluded; only an absent column keeps date rules', () => {
    expect(seasonPhaseExclusionReason(undefined)).toBeNull();
    for (const v of [null, '', 'regular', 'Preseason', 'PLAY_IN', 'unknown']) {
      expect(seasonPhaseExclusionReason(v)).not.toBeNull();
    }
  });
});

describe('context-projection candidate loader (loadProspectiveUpcomingGames)', () => {
  const games = MATRIX.map(([phase], i) => gameRow(`c${i}`, phase));

  it('selects analytics.games.season_phase and drops PRESEASON / UNCLASSIFIED', async () => {
    const { db, sql } = fakeDb({ hasPhaseColumn: true, games });
    const out = await loadProspectiveUpcomingGames(db, '2026-11-04T00:00:00.000Z', 48);
    const select = sql.find((s) => /FROM analytics\.games/.test(s))!;
    expect(select).toMatch(/\bseason_phase\b/);
    expect(select).not.toMatch(/NULL::text AS season_phase/);
    expect(out.map((g) => g.gameId)).toEqual(['c2', 'c3', 'c4', 'c5']);
    expect(out[0]).not.toHaveProperty('seasonPhase');
  });

  it('pre-migration schema: column not referenced, date rules unchanged', async () => {
    const { db, sql } = fakeDb({ hasPhaseColumn: false, games });
    const out = await loadProspectiveUpcomingGames(db, '2026-11-04T00:00:00.000Z', 48);
    expect(sql.find((s) => /FROM analytics\.games/.test(s))).toMatch(/NULL::text AS season_phase/);
    expect(out).toHaveLength(games.length);
  });

  it('NULL season_phase from a present column is excluded', async () => {
    const { db } = fakeDb({ hasPhaseColumn: true, games: [gameRow('n', null)] });
    expect(await loadProspectiveUpcomingGames(db, '2026-11-04T00:00:00.000Z', 48)).toEqual([]);
  });
});

describe('projection-ledger loader (cycle.loadUpcomingGames)', () => {
  it('selects season_phase and hands it to gameEligibleForLedgerPublish', async () => {
    const games = MATRIX.map(([phase], i) => gameRow(`l${i}`, phase));
    const { db, sql } = fakeDb({ hasPhaseColumn: true, games });
    const loaded = await loadLedgerGames(db, '2026-11-04T00:00:00.000Z');
    expect(sql.find((s) => /FROM analytics\.games/.test(s))).toMatch(/\bseason_phase\b/);
    expect(loaded.map((g) => g.seasonPhase)).toEqual(MATRIX.map(([p]) => p));
    expect(loaded.filter(gameEligibleForLedgerPublish).map((g) => g.gameId)).toEqual(['l2', 'l3', 'l4', 'l5']);
  });

  it('pre-migration schema: seasonPhase undefined and publish eligibility unchanged', async () => {
    const { db, sql } = fakeDb({ hasPhaseColumn: false, games: [gameRow('x', 'PRESEASON')] });
    const loaded = await loadLedgerGames(db, '2026-11-04T00:00:00.000Z');
    expect(sql.find((s) => /FROM analytics\.games/.test(s))).toMatch(/NULL::text AS season_phase/);
    expect(loaded[0].seasonPhase).toBeUndefined();
    expect(gameEligibleForLedgerPublish(loaded[0])).toBe(true);
  });
});

describe('shadow-projection loader + worker', () => {
  it('store selects season_phase', async () => {
    const { db, sql } = fakeDb({ hasPhaseColumn: true, games: [gameRow('s', 'IST')] });
    const loaded = await loadShadowGames(db, '2026');
    expect(sql.find((s) => /FROM analytics\.games/.test(s))).toMatch(/\bseason_phase\b/);
    expect(loaded[0].seasonPhase).toBe('IST');
  });

  const LIVE_ENV = {
    DATA_MODE: 'live_api',
    OFFSEASON_MODE: '0',
    CRON_DRY_RUN: '0',
    SHADOW_SNAPSHOT_WRITES: '1',
  };

  async function anchorFor(hasPhaseColumn: boolean, phaseOfEarlyGame: string) {
    const games = [
      gameRow('early', phaseOfEarlyGame, '2026-10-16T23:00:00.000Z'),
      gameRow('open', 'REGULAR', '2026-10-20T23:30:00.000Z'),
    ];
    const { db } = fakeDb({ hasPhaseColumn, games });
    const result = await runShadowScoreCycle({
      now: () => new Date('2026-10-01T00:00:00.000Z'),
      db,
      scorer: async () => [],
      loadArtifacts: async () => ({
        modelChecksums: { points: 'p', rebounds: 'r' },
        featureOrder: (await import('@/lib/betting/player-projection-shadow-protocol')).SHADOW_FEATURE_ORDER,
      }),
      env: LIVE_ENV,
    });
    return result.windowAnchor?.firstRegularSeasonTipoff ?? null;
  }

  it.each(['PRESEASON', 'UNCLASSIFIED'])(
    'worker drops a %s game before it can anchor the window or become due',
    async (phase) => {
      expect(await anchorFor(true, phase)).toBe('2026-10-20T23:30:00.000Z');
    }
  );

  it('REGULAR early game is kept (existing behavior)', async () => {
    expect(await anchorFor(true, 'REGULAR')).toBe('2026-10-16T23:00:00.000Z');
  });

  it('pre-migration schema: worker behavior unchanged', async () => {
    expect(await anchorFor(false, 'PRESEASON')).toBe('2026-10-16T23:00:00.000Z');
  });
});

describe('writer + classifier unchanged (DATA2E.1)', () => {
  it('final-preserve upsert does not touch season_phase', () => {
    expect(ANALYTICS_GAMES_FINAL_PRESERVE_UPSERT_SQL).not.toMatch(/season_phase/);
  });

  it('phase writer only fills UNCLASSIFIED rows and never writes UNCLASSIFIED', () => {
    expect(APPLY_SEASON_PHASE_SQL).toMatch(/season_phase = 'UNCLASSIFIED'/);
    expect(APPLY_SEASON_PHASE_SQL).toMatch(/\$2 <> 'UNCLASSIFIED'/);
  });

  it('explicit preseason request → PRESEASON/request_season_type; postseason=false never → REGULAR', () => {
    expect(classifySeasonPhase({ requestSeasonType: 'preseason' })).toEqual({
      phase: 'PRESEASON',
      source: 'request_season_type',
    });
    expect(classifySeasonPhase({ requestSeasonType: null, game: { postseason: false } }).phase).toBe('UNCLASSIFIED');
    expect(classifySeasonPhase({ game: { postseason: true } }).phase).toBe('UNCLASSIFIED');
  });
});
