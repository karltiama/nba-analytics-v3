/**
 * Phase 19B — game universe + freeze tests.
 */

import { describe, expect, it } from 'vitest';
import {
  ALL_STAR_EXHIBITION_ELIGIBILITY,
  PLAY_IN_ELIGIBILITY,
  PLAYOFF_ELIGIBILITY,
  PRESEASON_PRIMARY_ELIGIBILITY,
  PROSPECTIVE_GAME_UNIVERSE,
  classifyProspectiveCompetition,
  isCorruptScheduleStatus,
  isPrimaryProspectiveCompetitionGame,
} from '@/lib/context-projection/game-universe';
import { gameEligibleForLedgerPublish } from '@/lib/betting/projection-ledger/eligibility';

describe('Phase 19B — prospective game universe', () => {
  it('freezes eligibility flags', () => {
    expect(PRESEASON_PRIMARY_ELIGIBILITY).toBe('NO');
    expect(PLAY_IN_ELIGIBILITY).toBe('YES');
    expect(PLAYOFF_ELIGIBILITY).toBe('YES');
    expect(ALL_STAR_EXHIBITION_ELIGIBILITY).toBe('NO');
    expect([...PROSPECTIVE_GAME_UNIVERSE]).toContain('REGULAR_SEASON');
  });

  it('excludes preseason before the Oct 20 2026 regular-season open', () => {
    const c = classifyProspectiveCompetition({
      season: '2026',
      startTimeIso: '2026-10-19T23:00:00.000Z',
      status: '2026-10-19T23:00:00Z',
    });
    expect(c.class).toBe('PRESEASON');
    expect(c.primaryEligible).toBe(false);
  });

  it('includes Oct 20 2026 opening night as regular season', () => {
    const c = classifyProspectiveCompetition({
      season: '2026',
      startTimeIso: '2026-10-20T23:00:00.000Z',
      status: '2026-10-20T23:00:00Z',
    });
    expect(c.primaryEligible).toBe(true);
    expect(c.class).toBe('REGULAR_SEASON');
  });

  it('includes regular season on/after open', () => {
    const c = classifyProspectiveCompetition({
      season: '2026',
      startTimeIso: '2026-10-21T23:30:00.000Z',
      status: 'Scheduled',
    });
    expect(c.primaryEligible).toBe(true);
    expect(c.class).toBe('REGULAR_SEASON');
  });

  it('includes play-in/playoffs on/after floor', () => {
    const c = classifyProspectiveCompetition({
      season: '2025',
      startTimeIso: '2026-04-20T00:00:00.000Z',
      status: 'Final',
    });
    expect(c.primaryEligible).toBe(true);
    expect(c.class).toBe('PLAY_IN_OR_PLAYOFFS');
  });

  it('excludes cancelled', () => {
    const c = classifyProspectiveCompetition({
      season: '2026',
      startTimeIso: '2026-11-01T00:00:00.000Z',
      status: 'Cancelled',
    });
    expect(c.primaryEligible).toBe(false);
  });

  it('detects corrupt ISO status stamps', () => {
    expect(isCorruptScheduleStatus('2026-10-20T19:00:00Z')).toBe(true);
    expect(isCorruptScheduleStatus('Final')).toBe(false);
  });
});

describe('DATA2E.1 preseason fence (season_phase)', () => {
  const inSeason = { season: '2026', startTimeIso: '2026-11-05T00:00:00.000Z', status: 'Scheduled' };

  it('season_phase PRESEASON is never primary-eligible, even on an in-season date', () => {
    const c = classifyProspectiveCompetition({ ...inSeason, seasonPhase: 'PRESEASON' });
    expect(c).toEqual({ class: 'PRESEASON', primaryEligible: false, reason: 'season_phase_preseason' });
    expect(isPrimaryProspectiveCompetitionGame({ ...inSeason, seasonPhase: 'PRESEASON' })).toBe(false);
  });

  it('absent column / REGULAR / IST / PLAYIN / PLAYOFFS leave the frozen date rules unchanged', () => {
    const base = classifyProspectiveCompetition(inSeason);
    for (const seasonPhase of [undefined, 'REGULAR', 'IST', 'PLAYIN', 'PLAYOFFS']) {
      expect(classifyProspectiveCompetition({ ...inSeason, seasonPhase })).toEqual(base);
    }
    expect(
      classifyProspectiveCompetition({
        season: '2026',
        startTimeIso: '2026-10-05T23:00:00.000Z',
        status: 'Scheduled',
        seasonPhase: 'REGULAR',
      }).class
    ).toBe('PRESEASON');
  });

  it('DATA2E.1P: UNCLASSIFIED / null / unknown phase is excluded even on an in-season date', () => {
    for (const seasonPhase of [null, 'UNCLASSIFIED', '', 'EXHIBITION']) {
      expect(classifyProspectiveCompetition({ ...inSeason, seasonPhase })).toEqual({
        class: 'EXHIBITION_OR_UNKNOWN',
        primaryEligible: false,
        reason: 'season_phase_unclassified',
      });
    }
  });

  it('projection-ledger publish eligibility honours the fence', () => {
    const candidate = {
      gameId: '1',
      season: '2026',
      startTime: '2026-11-05T00:00:00.000Z',
      status: 'Scheduled',
      homeTeamId: '13',
      awayTeamId: '14',
    };
    expect(gameEligibleForLedgerPublish(candidate)).toBe(true);
    expect(gameEligibleForLedgerPublish({ ...candidate, seasonPhase: 'PRESEASON' })).toBe(false);
  });
});
