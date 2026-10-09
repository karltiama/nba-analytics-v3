import { describe, expect, it } from 'vitest';
import {
  evaluateLoadedSeasonPhaseReadiness,
  evaluateSeasonPhaseReadiness,
  operatingHorizon,
  summarizeSeasonPhaseReadiness,
  type ProviderScheduleEvidence,
  type ReadinessGameRow,
} from '@/lib/games/season-phase-readiness';
import { createPostgresGameStatusStore } from '@/lib/games/status-sync-db';

const H = { season: '2026', startDate: '2026-11-03', endDate: '2026-11-04' };

const row = (gameId: string, startTime: string, seasonPhase: string | null, seasonPhaseSource: string | null = 'request_season_type', season = '2026'): ReadinessGameRow => ({
  gameId,
  season,
  startTime,
  seasonPhase,
  seasonPhaseSource,
});

const regular = { phase: 'REGULAR', source: 'request_season_type' } as const;

const evidence = (games: ProviderScheduleEvidence['games'], over: Partial<ProviderScheduleEvidence> = {}): ProviderScheduleEvidence => ({
  startDate: H.startDate,
  endDate: H.endDate,
  complete: true,
  games,
  ...over,
});

describe('season-phase readiness', () => {
  it('operating horizon is today ET through tomorrow ET', () => {
    expect(operatingHorizon('2026', new Date('2026-11-04T03:30:00.000Z'))).toEqual({
      season: '2026',
      startDate: '2026-11-03',
      endDate: '2026-11-04',
    });
  });

  it('all labelled games with provider coverage are ready', () => {
    const r = evaluateSeasonPhaseReadiness({
      horizon: H,
      rows: [row('1', '2026-11-04T00:00:00Z', 'REGULAR'), row('2', '2026-11-05T00:30:00Z', 'IST', 'provider_ist_stage')],
      provider: evidence([
        { gameId: '1', etDate: '2026-11-03', phase: regular },
        { gameId: '2', etDate: '2026-11-04', phase: { phase: 'IST', source: 'provider_ist_stage' } },
      ]),
    });
    expect(r).toMatchObject({ ready: true, coverage: 'provider_verified', eligible: ['1', '2'], unclassified: [], missing: [] });
  });

  it('separates unclassified, ineligible, missing and eligible games', () => {
    const r = evaluateSeasonPhaseReadiness({
      horizon: H,
      rows: [
        row('1', '2026-11-04T00:00:00Z', 'REGULAR'),
        row('2', '2026-11-04T00:30:00Z', 'UNCLASSIFIED', null),
        row('3', '2026-11-04T01:00:00Z', 'PRESEASON'),
        row('9', '2026-11-10T00:00:00Z', 'UNCLASSIFIED', null),
      ],
      provider: evidence([
        { gameId: '1', etDate: '2026-11-03', phase: regular },
        { gameId: '2', etDate: '2026-11-03', phase: regular },
        { gameId: '4', etDate: '2026-11-04', phase: regular },
      ]),
    });
    expect(r.ready).toBe(false);
    expect(r.eligible).toEqual(['1']);
    expect(r.unclassified).toEqual(['2']);
    expect(r.ineligible).toEqual([{ gameId: '3', reason: 'preseason' }]);
    expect(r.missing).toEqual([{ gameId: '4', etDate: '2026-11-04', phase: 'REGULAR' }]);
    expect(r.reasons).toEqual(['unclassified_games:1', 'missing_games:1']);
  });

  it('an empty horizon is not ready without provider evidence, but is ready when provider confirms no games', () => {
    expect(evaluateSeasonPhaseReadiness({ horizon: H, rows: [] }).reasons).toContain('empty_horizon_without_provider_evidence');
    expect(evaluateSeasonPhaseReadiness({ horizon: H, rows: [], provider: evidence([]) }).ready).toBe(true);
  });

  it('only preseason games in the horizon is not ready without evidence', () => {
    const r = evaluateSeasonPhaseReadiness({ horizon: H, rows: [row('3', '2026-11-04T01:00:00Z', 'PRESEASON')] });
    expect(r.ready).toBe(false);
    expect(r.reasons).toEqual(['empty_horizon_without_provider_evidence']);
  });

  it('db-only coverage can be ready but warns that missing games are unverifiable', () => {
    const r = evaluateSeasonPhaseReadiness({ horizon: H, rows: [row('1', '2026-11-04T00:00:00Z', 'REGULAR')] });
    expect(r).toMatchObject({ ready: true, coverage: 'db_only' });
    expect(r.warnings).toContain('missing_games_unverifiable_without_provider_evidence');
  });

  it('incomplete or partial-window provider evidence fails closed', () => {
    const rows = [row('1', '2026-11-04T00:00:00Z', 'REGULAR')];
    const games = [{ gameId: '1', etDate: '2026-11-03', phase: regular }];
    for (const provider of [evidence(games, { complete: false }), evidence(games, { endDate: '2026-11-03' })]) {
      const r = evaluateSeasonPhaseReadiness({ horizon: H, rows, provider });
      expect(r.ready).toBe(false);
      expect(r.reasons).toContain('provider_evidence_incomplete_or_not_covering_horizon');
      expect(r.coverage).toBe('db_only');
    }
  });

  it('a phase without provider-evidence source is never eligible (no numeric-id or flag-only labels)', () => {
    for (const source of [null, 'none', 'provider_postseason_flag', 'game_id_range']) {
      const r = evaluateSeasonPhaseReadiness({ horizon: H, rows: [row('1', '2026-11-04T00:00:00Z', 'REGULAR', source)] });
      expect(r.ready).toBe(false);
      expect(r.ineligible).toEqual([{ gameId: '1', reason: 'unsupported_phase_source' }]);
      expect(r.reasons).toContain('classification_anomalies:1');
    }
  });

  it('unknown phase labels block readiness', () => {
    const r = evaluateSeasonPhaseReadiness({ horizon: H, rows: [row('1', '2026-11-04T00:00:00Z', 'ALLSTAR')] });
    expect(r.ineligible).toEqual([{ gameId: '1', reason: 'unknown_phase' }]);
    expect(r.ready).toBe(false);
  });

  it('the NBA Cup championship is never eligible or missing, even if a row was labelled REGULAR', () => {
    const cupFinal = { phase: 'UNCLASSIFIED', source: 'provider_ist_stage' } as const;
    const labelled = evaluateSeasonPhaseReadiness({
      horizon: H,
      rows: [row('1', '2026-11-04T00:00:00Z', 'REGULAR'), row('7', '2026-11-05T01:00:00Z', 'REGULAR')],
      provider: evidence([
        { gameId: '1', etDate: '2026-11-03', phase: regular },
        { gameId: '7', etDate: '2026-11-04', phase: cupFinal },
      ]),
    });
    expect(labelled.eligible).toEqual(['1']);
    expect(labelled.ineligible).toEqual([{ gameId: '7', reason: 'nba_cup_final' }]);
    expect(labelled.ready).toBe(true);

    const absent = evaluateSeasonPhaseReadiness({
      horizon: H,
      rows: [row('1', '2026-11-04T00:00:00Z', 'REGULAR')],
      provider: evidence([
        { gameId: '1', etDate: '2026-11-03', phase: regular },
        { gameId: '7', etDate: '2026-11-04', phase: cupFinal },
      ]),
    });
    expect(absent.missing).toEqual([]);
    expect(absent.ready).toBe(true);
  });

  it('provider postseason-flag-only rows are not counted as missing regular-season games', () => {
    const r = evaluateSeasonPhaseReadiness({
      horizon: H,
      rows: [row('1', '2026-11-04T00:00:00Z', 'REGULAR')],
      provider: evidence([
        { gameId: '1', etDate: '2026-11-03', phase: regular },
        { gameId: '8', etDate: '2026-11-04', phase: { phase: 'UNCLASSIFIED', source: 'provider_postseason_flag' } },
      ]),
    });
    expect(r.missing).toEqual([]);
  });

  it('labelled games dated before opening night or from another season are excluded', () => {
    const early = { season: '2026', startDate: '2026-10-19', endDate: '2026-10-20' };
    const r = evaluateSeasonPhaseReadiness({
      horizon: early,
      rows: [
        row('1', '2026-10-19T23:00:00Z', 'REGULAR'),
        row('2', '2026-10-20T23:30:00Z', 'REGULAR'),
        row('3', '2026-10-20T23:00:00Z', 'REGULAR', 'request_season_type', '2025'),
      ],
    });
    expect(r.eligible).toEqual(['2']);
    expect(r.ineligible).toEqual([
      { gameId: '1', reason: 'before_regular_season_open' },
      { gameId: '3', reason: 'season_mismatch' },
    ]);
  });

  it('summary caps id lists at 50 and keeps exact counts', () => {
    const rows = Array.from({ length: 60 }, (_, i) => row(String(i), '2026-11-04T00:00:00Z', 'UNCLASSIFIED', null));
    const s = summarizeSeasonPhaseReadiness(evaluateSeasonPhaseReadiness({ horizon: H, rows }));
    expect(s.counts.unclassified).toBe(60);
    expect(s.unclassified).toHaveLength(50);
    expect(s.ready).toBe(false);
  });

  it('postgres loader fails closed when season-phase columns are absent and issues read-only selects', async () => {
    const sqls: string[] = [];
    const missingCols = createPostgresGameStatusStore({}, {
      query: async (sql: string) => {
        sqls.push(sql);
        return { rows: [{ n: 1 }] };
      },
    } as never);
    const rowsMissing = await missingCols.loadReadinessRows!(H.startDate, H.endDate);
    expect(rowsMissing).toBeNull();
    expect(evaluateLoadedSeasonPhaseReadiness({ horizon: H, rows: rowsMissing })).toMatchObject({
      ready: false,
      reasons: ['season_phase_columns_missing'],
    });

    const store = createPostgresGameStatusStore({}, {
      query: async (sql: string) => {
        sqls.push(sql);
        if (sql.includes('information_schema')) return { rows: [{ n: 2 }] };
        return {
          rows: [
            { game_id: '1', season: '2026', start_time: new Date('2026-11-04T00:00:00Z'), season_phase: 'REGULAR', season_phase_source: 'request_season_type' },
          ],
        };
      },
    } as never);
    const rows = await store.loadReadinessRows!(H.startDate, H.endDate);
    expect(evaluateLoadedSeasonPhaseReadiness({ horizon: H, rows })).toMatchObject({ ready: true, eligible: ['1'] });
    for (const sql of sqls) expect(sql.trim().toLowerCase().startsWith('select')).toBe(true);
  });
});
