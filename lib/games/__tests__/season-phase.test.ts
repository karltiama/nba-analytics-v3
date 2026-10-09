import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifySeasonPhase, strongerSeasonPhase } from '@/lib/games/season-phase';
import {
  GAME_STATUS_SYNC_PRESEASON_DISCOVERY_ENV,
  isPreseasonDiscoveryEnabled,
  planStatusSyncQueries,
  planStatusSyncQuery,
  statusSyncRequestUrl,
} from '@/lib/games/status-sync-query';

describe('classifySeasonPhase (DATA1 §8.4)', () => {
  it('explicit request season_type is authoritative', () => {
    expect(classifySeasonPhase({ requestSeasonType: 'preseason' })).toEqual({
      phase: 'PRESEASON',
      source: 'request_season_type',
    });
    expect(classifySeasonPhase({ requestSeasonType: 'regular' }).phase).toBe('REGULAR');
    expect(classifySeasonPhase({ requestSeasonType: 'ist' }).phase).toBe('IST');
    expect(classifySeasonPhase({ requestSeasonType: 'playin' }).phase).toBe('PLAYIN');
    expect(classifySeasonPhase({ requestSeasonType: 'playoffs' }).phase).toBe('PLAYOFFS');
  });

  it('request season_type outranks provider fields', () => {
    expect(
      classifySeasonPhase({ requestSeasonType: 'preseason', game: { ist_stage: 'group', postseason: true } })
    ).toEqual({ phase: 'PRESEASON', source: 'request_season_type' });
  });

  it('an unparameterized response is never classified REGULAR', () => {
    expect(classifySeasonPhase({ requestSeasonType: null, game: {} })).toEqual({
      phase: 'UNCLASSIFIED',
      source: 'none',
    });
    expect(classifySeasonPhase({ game: { ist_stage: null, postseason: false } }).phase).toBe('UNCLASSIFIED');
    expect(classifySeasonPhase({ requestSeasonType: 'something_new' }).phase).toBe('UNCLASSIFIED');
  });

  it('regular request with an ist_stage is IST (NBA Cup stays labelled); preseason request is not', () => {
    expect(classifySeasonPhase({ requestSeasonType: 'regular', game: { ist_stage: 'group' } })).toEqual({
      phase: 'IST',
      source: 'provider_ist_stage',
    });
    expect(classifySeasonPhase({ requestSeasonType: 'regular', game: { ist_stage: null } }).phase).toBe('REGULAR');
    expect(classifySeasonPhase({ requestSeasonType: 'preseason', game: { ist_stage: 'group' } }).phase).toBe(
      'PRESEASON'
    );
  });

  it('NBA Cup championship stage is UNCLASSIFIED under any request; semifinal stays IST', () => {
    for (const requestSeasonType of ['regular', 'ist', null]) {
      expect(classifySeasonPhase({ requestSeasonType, game: { ist_stage: 'Championship' } })).toEqual({
        phase: 'UNCLASSIFIED',
        source: 'provider_ist_stage',
      });
    }
    expect(classifySeasonPhase({ requestSeasonType: 'regular', game: { ist_stage: 'final' } }).phase).toBe(
      'UNCLASSIFIED'
    );
    expect(classifySeasonPhase({ requestSeasonType: 'regular', game: { ist_stage: 'semifinal' } }).phase).toBe('IST');
  });

  it('ist_stage → IST; postseason flag alone stays UNCLASSIFIED', () => {
    expect(classifySeasonPhase({ game: { ist_stage: 'quarterfinal' } })).toEqual({
      phase: 'IST',
      source: 'provider_ist_stage',
    });
    expect(classifySeasonPhase({ game: { ist_stage: '' } }).phase).toBe('UNCLASSIFIED');
    expect(classifySeasonPhase({ game: { postseason: true } })).toEqual({
      phase: 'UNCLASSIFIED',
      source: 'provider_postseason_flag',
    });
  });

  it('merging prefers request-scoped classifications and never lets UNCLASSIFIED win', () => {
    const pre = classifySeasonPhase({ requestSeasonType: 'preseason' });
    const ist = classifySeasonPhase({ game: { ist_stage: 'group' } });
    const none = classifySeasonPhase({});
    expect(strongerSeasonPhase(none, pre)).toEqual(pre);
    expect(strongerSeasonPhase(pre, none)).toEqual(pre);
    expect(strongerSeasonPhase(ist, pre)).toEqual(pre);
    expect(strongerSeasonPhase(none, ist)).toEqual(ist);
  });
});

describe('preseason discovery query planning', () => {
  const now = new Date('2026-10-05T15:00:00.000Z');

  it('flag defaults to disabled; only 1/true enable it', () => {
    expect(isPreseasonDiscoveryEnabled({})).toBe(false);
    for (const v of ['0', 'false', 'yes', 'on', '']) {
      expect(isPreseasonDiscoveryEnabled({ [GAME_STATUS_SYNC_PRESEASON_DISCOVERY_ENV]: v })).toBe(false);
    }
    expect(isPreseasonDiscoveryEnabled({ [GAME_STATUS_SYNC_PRESEASON_DISCOVERY_ENV]: '1' })).toBe(true);
    expect(isPreseasonDiscoveryEnabled({ [GAME_STATUS_SYNC_PRESEASON_DISCOVERY_ENV]: 'TRUE' })).toBe(true);
  });

  it('flag false: one primary query with explicit season_type=regular', () => {
    const plans = planStatusSyncQueries({ targetSeason: 2026, now, preseasonDiscovery: false });
    const primary = planStatusSyncQuery({ targetSeason: 2026, now });
    expect(plans).toHaveLength(1);
    expect(statusSyncRequestUrl(plans[0], null)).toBe(statusSyncRequestUrl(primary, null));
    expect(new URL(statusSyncRequestUrl(plans[0], null)).searchParams.get('season_type')).toBe('regular');
    expect(plans[0].seasonTypeRequested).toBe('regular');
  });

  it('full_season mode also sends season_type=regular', () => {
    const plan = planStatusSyncQuery({ targetSeason: 2026, now, mode: 'full_season' });
    expect(plan.params.get('season_type')).toBe('regular');
    expect(plan.seasonTypeRequested).toBe('regular');
  });

  it('window reaching the known postseason floor adds playin and playoffs queries', () => {
    const plans = planStatusSyncQueries({
      targetSeason: 2025,
      now: new Date('2026-04-15T15:00:00.000Z'),
      preseasonDiscovery: false,
    });
    expect(plans.map((p) => p.seasonTypeRequested)).toEqual(['regular', 'playin', 'playoffs']);
    expect(new Set(plans.map((p) => `${p.startDate}|${p.endDate}|${p.maxPages}`)).size).toBe(1);
  });

  it('flag true: primary query kept first, plus season_type=preseason for the same window and cap', () => {
    const plans = planStatusSyncQueries({ targetSeason: 2026, now, preseasonDiscovery: true });
    expect(plans).toHaveLength(2);
    const [primary, pre] = plans;
    expect(statusSyncRequestUrl(primary, null)).toBe(statusSyncRequestUrl(planStatusSyncQuery({ targetSeason: 2026, now }), null));
    expect(pre.seasonTypeRequested).toBe('preseason');
    expect(pre.startDate).toBe(primary.startDate);
    expect(pre.endDate).toBe(primary.endDate);
    expect(pre.maxPages).toBe(primary.maxPages);
    expect(pre.maxPages).toBe(3);
    const url = new URL(statusSyncRequestUrl(pre, 7));
    expect(url.searchParams.get('season_type')).toBe('preseason');
    expect(url.searchParams.get('seasons[]')).toBe('2026');
    expect(url.searchParams.get('cursor')).toBe('7');
    expect(primary.params.get('season_type')).toBe('regular');
  });
});

describe('prepared season-phase migration (not applied)', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../../db/schemas/MIGRATION_analytics_games_season_phase.sql'),
    'utf8'
  ).replace(/\r\n/g, '\n');
  const code = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .toLowerCase();

  it('is marked prepared-only and defaults existing rows to UNCLASSIFIED', () => {
    expect(sql).toMatch(/PREPARED ONLY/);
    expect(code).toMatch(/season_phase text not null default 'unclassified'/);
    expect(code).toMatch(/season_phase_source text[,;\n]/);
    expect(code).not.toMatch(/default 'regular'/);
  });

  it('has no backfill, no destructive statements, and enum checks', () => {
    expect(code).not.toMatch(/\bupdate\b/);
    expect(code).not.toMatch(/\bdelete\b|\btruncate\b|drop table|drop column/);
    expect(code).toMatch(/'preseason', 'regular', 'ist', 'playin', 'playoffs', 'unclassified'/);
    expect(code).toMatch(/'request_season_type', 'provider_ist_stage', 'provider_postseason_flag'/);
    expect(code).toMatch(/season_phase = 'unclassified' or season_phase_source is not null/);
    expect(code).toMatch(/lock_timeout/);
  });
});

describe('prepared historical season-phase backfill (not applied)', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../../../db/schemas/MIGRATION_analytics_games_season_phase_backfill.sql'),
    'utf8'
  ).replace(/\r\n/g, '\n');
  const code = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
    .toLowerCase();

  it('covers only protected history seasons and only fills UNCLASSIFIED rows', () => {
    expect(code).toMatch(/\('2023'/);
    expect(code).toMatch(/\('2024'/);
    expect(code).toMatch(/\('2025'/);
    expect(code).not.toMatch(/'2026'/);
    expect(code).toMatch(/a\.season_phase = 'unclassified'/);
    expect(code).toMatch(/'historical_backfill_v1'/);
    expect(code).not.toMatch(/\bdelete\b|\btruncate\b|drop table|drop column/);
  });

  it('never defaults to REGULAR and reconciles counts before writing', () => {
    expect(code).toMatch(/else null/);
    expect(code).toMatch(/raise exception/);
    expect(code.indexOf('raise exception')).toBeLessThan(code.indexOf('update analytics.games'));
  });
});
