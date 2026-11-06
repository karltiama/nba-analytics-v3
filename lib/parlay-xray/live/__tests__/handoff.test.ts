import { describe, expect, it } from 'vitest';
import { CATALOG, extractedLeg } from '@/lib/parlay-xray/resolution/__tests__/fixtures';
import { handoffLiveXrayParlay, liveDateCandidates } from '../handoff';

const NOW = new Date('2026-03-17T20:00:00.000Z');

function jokicLeg(gameDate: string | null) {
  return extractedLeg({
    player: 'Nikola Jokic',
    team: 'DEN',
    opponent: 'OKC',
    market: 'points',
    side: 'over',
    line: 27.5,
    odds: -103,
    sportsbook: 'DraftKings',
    gameDate,
  });
}

describe('live XRay handoff', () => {
  it('matches a slip without a date to today ET', () => {
    const result = handoffLiveXrayParlay([jokicLeg(null)], CATALOG, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.legs[0]!.offer.gameId).toBe('game-den-okc-2026-03-17');
    expect(result.legs[0]!.offer.playerId).toBe('203999');
    expect(result.legs[0]!.offer.snapshotKind).toBe('live_current');
  });

  it('uses only the slip date when one was read', () => {
    expect(liveDateCandidates(jokicLeg('2025-04-01'), NOW)).toEqual(['2025-04-01']);
    expect(liveDateCandidates(jokicLeg(null), NOW)).toEqual(['2026-03-17', '2026-03-18']);
  });

  it('does not attach a stale slip date to a different game', () => {
    const result = handoffLiveXrayParlay([jokicLeg('2026-01-02')], CATALOG, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ playerName: 'Nikola Jokic', reason: 'NO_GAME' });
  });
});

describe('live XRay handoff with roster teams', () => {
  const ROSTER = new Map([['203999', 'DEN']]);

  it('corrects a misread matchup to the player team game', () => {
    const leg = { ...jokicLeg(null), teamAbbr: { value: 'MIA', status: 'known' as const }, opponentAbbr: { value: 'MIL', status: 'known' as const } };
    const result = handoffLiveXrayParlay([leg], CATALOG, NOW, ROSTER);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.legs[0]!.offer.gameId).toBe('game-den-okc-2026-03-17');
  });

  it('fails when the player team has no game on the slip date', () => {
    const result = handoffLiveXrayParlay([jokicLeg('2026-01-02')], CATALOG, NOW, ROSTER);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ playerName: 'Nikola Jokic', reason: 'NO_TEAM_GAME' });
  });
});
