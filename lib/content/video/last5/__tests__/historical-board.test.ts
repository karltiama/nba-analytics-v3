import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURRENT_BOARD_MANIFEST_SHA256, FROZEN_BOARD_DELETE_ROWS, FROZEN_BOARD_SURVIVOR_ROWS } from '@/lib/props/current-board-reclamation';
import { resolveLast5Line, type BookLineQuote } from '../snapshot';

const TODAY = '2026-11-14';
const PAST = '2026-11-12';

const boardMain: BookLineQuote[] = [
  { sportsbook: 'a', side: 'over', line: 24.5, impliedProbability: 0.52 },
  { sportsbook: 'a', side: 'over', line: 20.5, impliedProbability: 0.8 },
  { sportsbook: 'b', side: 'over', line: 24.5, impliedProbability: 0.51 },
];

const researchClose: BookLineQuote[] = [
  { sportsbook: 'a', side: 'over', line: 20.5, impliedProbability: 0.8 },
  { sportsbook: 'b', side: 'over', line: 20.5, impliedProbability: 0.79 },
];

describe('last-5 line after historical board removal', () => {
  it('uses the board consensus for a past date while those rows remain', () => {
    expect(resolveLast5Line({
      date: PAST,
      todayEt: TODAY,
      gamesOnDate: 8,
      boardQuotes: boardMain,
      researchCloses: researchClose,
    })).toEqual({ status: 'ready', line: 24.5, bookCount: 2 });
  });

  it('does not substitute the research close when the past-date board is empty', () => {
    expect(resolveLast5Line({
      date: PAST,
      todayEt: TODAY,
      gamesOnDate: 8,
      boardQuotes: [],
      researchCloses: researchClose,
    })).toEqual({ status: 'historical_lines_unavailable' });
  });

  it('still reads a current-date board and does not treat an empty current slate as reclaimed', () => {
    expect(resolveLast5Line({
      date: TODAY,
      todayEt: TODAY,
      gamesOnDate: 9,
      boardQuotes: boardMain,
      researchCloses: [],
    })).toEqual({ status: 'ready', line: 24.5, bookCount: 2 });
    expect(resolveLast5Line({
      date: TODAY,
      todayEt: TODAY,
      gamesOnDate: 9,
      boardQuotes: [],
      researchCloses: researchClose,
    })).toEqual({ status: 'empty_slate' });
  });

  it('leaves the frozen board manifest unchanged', () => {
    const raw = readFileSync('lib/props/current-board-reclamation-manifest.json');
    expect(createHash('sha256').update(raw).digest('hex')).toBe(CURRENT_BOARD_MANIFEST_SHA256);
    expect(FROZEN_BOARD_DELETE_ROWS).toBe(142_602);
    expect(FROZEN_BOARD_SURVIVOR_ROWS).toBe(27_867);
  });
});
