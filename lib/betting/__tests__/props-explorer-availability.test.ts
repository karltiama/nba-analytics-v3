import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { historicalAvailabilityView, historicalUnavailableText } from '../props-explorer-empty';

const base = {
  marketContext: 'historical' as const,
  dateLabel: 'Nov 23',
  gameSelected: false,
  gameUnknown: false,
  gameLabel: (gameId: string) => (gameId === '101' ? 'BOS @ NYK' : `Game ${gameId}`),
};

describe('historical Props Explorer availability', () => {
  it('shows a verified historical game without an availability warning', () => {
    const view = historicalAvailabilityView({
      ...base,
      rowCount: 4,
      totalMatching: 4,
      unavailableGames: [],
      filtersActive: false,
    });
    expect(view.kind).toBe('rows');
    expect(view.notice).toBeNull();
  });

  it('keeps a verified game with no matching filters on the empty-filter copy', () => {
    const view = historicalAvailabilityView({
      ...base,
      rowCount: 0,
      totalMatching: 0,
      unavailableGames: [],
      filtersActive: true,
      gameSelected: true,
    });
    expect(view.kind).toBe('empty');
    if (view.kind !== 'empty') return;
    expect(view.title).toBe('No stored prop observations for this game yet.');
    expect(view.notice).toBeNull();
  });

  it('does not describe a missing artifact as an empty market', () => {
    const view = historicalAvailabilityView({
      ...base,
      rowCount: 0,
      totalMatching: 0,
      unavailableGames: [{ gameId: '101', reason: 'missing' }],
      filtersActive: false,
      gameSelected: true,
    });
    expect(view.kind).toBe('unavailable');
    if (view.kind !== 'unavailable') return;
    expect(view.title).toMatch(/unavailable/i);
    expect(`${view.title} ${view.detail} ${view.notice.games[0].text}`).not.toMatch(/no stored prop observations/i);
    expect(view.detail).toMatch(/not a finding that no props were offered/i);
    expect(view.countLabel).toBe('Historical data unavailable');
    expect(view.notice.games[0].label).toBe('BOS @ NYK');
    expect(historicalUnavailableText('missing')).not.toMatch(/permanently|s3:|bucket|archive key/i);
  });

  it('maps incomplete coverage, a bad checksum, and a postponed game without storage details', () => {
    for (const reason of ['incomplete', 'missing_archive', 'unverifiable', 'invalid_checksum', 'not_final']) {
      const text = historicalUnavailableText(reason);
      expect(text).not.toMatch(/s3:|bucket|json\.gz|pull_run/i);
      expect(text).not.toMatch(/permanently missing/i);
    }
    expect(historicalUnavailableText('not_final')).toMatch(/not final/i);
    expect(historicalUnavailableText('invalid_checksum')).toMatch(/could not be verified/i);
    expect(historicalUnavailableText('incomplete')).toMatch(/incomplete/i);
  });

  it('keeps verified rows and names unavailable games on a mixed date', () => {
    const view = historicalAvailabilityView({
      ...base,
      rowCount: 2,
      totalMatching: 2,
      unavailableGames: [{ gameId: '202', reason: 'unverifiable' }],
      filtersActive: false,
    });
    expect(view.kind).toBe('rows');
    expect(view.notice?.games.map((game) => game.gameId)).toEqual(['202']);
    expect(view.notice?.title).toMatch(/verified closing evidence/i);
  });

  it('lists distinct reasons for several unavailable games', () => {
    const view = historicalAvailabilityView({
      ...base,
      rowCount: 0,
      totalMatching: 0,
      unavailableGames: [
        { gameId: '101', reason: 'missing' },
        { gameId: '202', reason: 'not_final' },
      ],
      filtersActive: false,
    });
    expect(view.kind).toBe('unavailable');
    if (view.kind !== 'unavailable') return;
    expect(view.notice.games.map((game) => game.text)).toEqual([
      historicalUnavailableText('missing'),
      historicalUnavailableText('not_final'),
    ]);
    expect(new Set(view.notice.games.map((game) => game.text)).size).toBe(2);
  });

  it('does not treat every unavailable game as an empty filter when a filter is active', () => {
    const view = historicalAvailabilityView({
      ...base,
      rowCount: 0,
      totalMatching: 0,
      unavailableGames: [{ gameId: '101', reason: 'missing' }],
      filtersActive: true,
      gameSelected: true,
    });
    expect(view.kind).toBe('unavailable');
    if (view.kind !== 'unavailable') return;
    expect(view.title).not.toMatch(/no stored prop observations/i);
    expect(view.detail).toMatch(/not a finding that no props were offered/i);
    expect(view.notice.games[0].text).toMatch(/not a finding that no props were offered/i);
  });

  it('leaves the existing empty copy in place when unavailableGames is absent', () => {
    const view = historicalAvailabilityView({
      ...base,
      rowCount: 0,
      totalMatching: 0,
      unavailableGames: undefined,
      filtersActive: false,
    });
    expect(view.kind).toBe('empty');
    if (view.kind !== 'empty') return;
    expect(view.title).toBe('No stored prop observations for this date yet.');
    expect(view.detail).toMatch(/Nov 23/);
    expect(view.notice).toBeNull();
  });

  it('does not change a current-date empty board', () => {
    const view = historicalAvailabilityView({
      ...base,
      marketContext: 'live',
      rowCount: 0,
      totalMatching: 0,
      unavailableGames: [{ gameId: '101', reason: 'missing' }],
      filtersActive: false,
    });
    expect(view.kind).toBe('empty');
    if (view.kind !== 'empty') return;
    expect(view.title).toBe('No stored prop observations for this date yet.');
    expect(view.notice).toBeNull();
  });

  it('does not call S3 or write to the database from the presentation module', () => {
    const source = readFileSync(new URL('../props-explorer-empty.ts', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../../../app/betting/props-explorer/page.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(insert|update|delete|ListBucket|s3:\/\/)\b/i);
    expect(page).toContain('historicalAvailabilityView');
    expect(page).toContain('unavailableGames');
    expect(page).not.toContain('propsExplorerEmptyCopy({');
  });
});
