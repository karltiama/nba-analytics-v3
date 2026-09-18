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
} from '@/lib/context-projection/game-universe';

describe('Phase 19B — prospective game universe', () => {
  it('freezes eligibility flags', () => {
    expect(PRESEASON_PRIMARY_ELIGIBILITY).toBe('NO');
    expect(PLAY_IN_ELIGIBILITY).toBe('YES');
    expect(PLAYOFF_ELIGIBILITY).toBe('YES');
    expect(ALL_STAR_EXHIBITION_ELIGIBILITY).toBe('NO');
    expect([...PROSPECTIVE_GAME_UNIVERSE]).toContain('REGULAR_SEASON');
  });

  it('excludes preseason before RS open', () => {
    const c = classifyProspectiveCompetition({
      season: '2026',
      startTimeIso: '2026-10-20T19:00:00.000Z',
      status: '2026-10-20T19:00:00Z',
    });
    expect(c.class).toBe('PRESEASON');
    expect(c.primaryEligible).toBe(false);
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
