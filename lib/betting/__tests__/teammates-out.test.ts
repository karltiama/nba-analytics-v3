import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ query: vi.fn(), queryOne: vi.fn() }));
import { asOfLabel, chooseSplit, selectTeammatesOut, wowyHref } from '@/lib/betting/teammates-out';
import { seasonLabel, splitMetricValue, type TeammateOutSplit } from '@/lib/betting/teammates-out-display';

const stats = { minutes: 30, pts: 20, reb: 5, ast: 4, tpm: 2 };
const split = (season: string, tier: TeammateOutSplit['tier']): TeammateOutSplit => ({
  season, tier, withGames: 10, withoutGames: tier === 'insufficient' ? 1 : 9, with: stats, without: stats,
});

describe('chooseSplit', () => {
  it('prefers this season once it has enough games on both sides', () => {
    expect(chooseSplit(split('2026', 'low_support'), split('2025', 'adequate'))?.season).toBe('2026');
  });
  it('falls back to last season while this season is too thin', () => {
    expect(chooseSplit(split('2026', 'insufficient'), split('2025', 'adequate'))?.season).toBe('2025');
  });
  it('keeps the thin split when neither season has enough, so the UI can say so', () => {
    expect(chooseSplit(split('2026', 'insufficient'), split('2025', 'insufficient'))?.season).toBe('2026');
    expect(chooseSplit(null, null)).toBeNull();
  });
});

describe('display helpers', () => {
  it('maps the active stat tab to the split value', () => {
    expect(splitMetricValue(stats, 'pts')).toBe(20);
    expect(splitMetricValue(stats, '3pm')).toBe(2);
    expect(splitMetricValue(stats, 'pra')).toBe(29);
    expect(splitMetricValue({ ...stats, reb: null }, 'pra')).toBeNull();
  });
  it('labels seasons and links to the WOWY page', () => {
    expect(seasonLabel('2025')).toBe('2025-26');
    expect(seasonLabel('2099')).toBe('2099-00');
    expect(wowyHref({ subjectId: '1', teammateId: '2', season: '2025', teamId: '30' })).toBe(
      '/wowy?subject=1&teammate=2&season=2025&teamId=30'
    );
  });
});

describe('selectTeammatesOut', () => {
  const now = new Date('2026-11-04T20:00:00Z');
  const env = { INJURY_SERVING_ENABLED: '1' };
  const row = (over: Partial<Parameters<typeof selectTeammatesOut>[0]['rows'][number]>) => ({
    playerId: 'p', name: 'Player', status: 'Out', snapshotAt: '2026-11-04T18:00:00Z',
    currentSeasonGames: 6, currentSeasonAvgMinutes: 30, priorSeasonAvgMinutes: 28, ...over,
  });

  it('lists rotation players out, most severe and most minutes first', () => {
    const got = selectTeammatesOut({
      gameEtDate: '2026-11-04', env, now,
      rows: [
        row({ playerId: 'q', name: 'Q guy', status: 'Questionable', currentSeasonAvgMinutes: 35 }),
        row({ playerId: 'a', name: 'Bench', status: 'Out', currentSeasonAvgMinutes: 12 }),
        row({ playerId: 'b', name: 'Starter', status: 'Out - knee', currentSeasonAvgMinutes: 33 }),
        row({ playerId: 'c', name: 'Deep bench', status: 'Out', currentSeasonAvgMinutes: 6 }),
        row({ playerId: 'd', name: 'Probable', status: 'Probable' }),
      ],
    });
    expect(got.map((t) => [t.playerId, t.status])).toEqual([['b', 'Out'], ['a', 'Out'], ['q', 'Q']]);
  });

  it('uses last season minutes until he has 3 games this season', () => {
    const got = selectTeammatesOut({ gameEtDate: '2026-11-04', env, now,
      rows: [row({ currentSeasonGames: 1, currentSeasonAvgMinutes: 4, priorSeasonAvgMinutes: 31 })] });
    expect(got[0]?.avgMinutes).toBe(31);
  });

  it('drops stale reports, frozen serving, and yesterday Questionable', () => {
    expect(selectTeammatesOut({ gameEtDate: '2026-11-04', env, now, rows: [row({ snapshotAt: '2026-11-01T18:00:00Z' })] })).toEqual([]);
    expect(selectTeammatesOut({ gameEtDate: '2026-11-04', env: { INJURY_SERVING_ENABLED: '0' }, now, rows: [row({})] })).toEqual([]);
    expect(selectTeammatesOut({ gameEtDate: '2026-11-04', env, now,
      rows: [row({ status: 'Questionable', snapshotAt: '2026-11-03T22:00:00Z' })] })).toEqual([]);
  });

  it('labels the report time in ET', () => {
    expect(asOfLabel(new Date('2026-11-04T18:00:00Z'), '2026-11-04')).toBe('as of 1:00 PM ET');
    expect(asOfLabel(new Date('2026-11-03T22:00:00Z'), '2026-11-04')).toBe('as of Nov 3, 5:00 PM ET');
  });
});
