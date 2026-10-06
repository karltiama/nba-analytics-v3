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

  it('flag false: exactly the existing query, unchanged URL', () => {
    const plans = planStatusSyncQueries({ targetSeason: 2026, now, preseasonDiscovery: false });
    const legacy = planStatusSyncQuery({ targetSeason: 2026, now });
    expect(plans).toHaveLength(1);
    expect(statusSyncRequestUrl(plans[0], null)).toBe(statusSyncRequestUrl(legacy, null));
    expect(statusSyncRequestUrl(plans[0], null)).not.toContain('season_type');
    expect(plans[0].seasonTypeRequested).toBeNull();
  });

  it('flag true: existing query kept first, plus season_type=preseason for the same window and cap', () => {
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
    expect(primary.params.has('season_type')).toBe(false);
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
