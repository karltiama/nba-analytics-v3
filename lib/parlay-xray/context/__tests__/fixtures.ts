import { known, unknown, withDerivedResolution } from '@/lib/parlay-xray/fields';
import type { CanonicalParlayLegResolution } from '@/lib/parlay-xray/resolution/types';
import type { ExtractedParlayLeg, ParlayLegSide, XrayPropKind } from '@/lib/parlay-xray/types';
import { matchHistoricalParlayLeg } from '@/lib/parlay-xray/replay/match';
import { replayInput } from '@/lib/parlay-xray/replay/__tests__/fixtures';
import type { HistoricalMovementRow } from '@/lib/parlay-xray/replay/types';
import type { CanonicalPropType } from '@/lib/betting/market-movement';
import type { XrayArchivedProjection, XrayPriorPlayerLog, XrayPriorTeamStat } from '../types';

export const CUTOFF = '2026-04-03T01:30:00.000Z';
export const TARGET_GAME = '18447934';
export const PLAYER = '1630598';
export const TEAM = 'okc';
export const OPP = 'den';

export function extracted(partial: {
  player?: string;
  market?: XrayPropKind;
  side?: ParlayLegSide;
  line?: number;
  sportsbook?: string;
}): ExtractedParlayLeg {
  return withDerivedResolution({
    id: 'leg-ajay',
    playerDisplayName: known(partial.player ?? 'Ajay Mitchell'),
    playerId: unknown(),
    nbaPlayerId: unknown(),
    teamAbbr: known('OKC'),
    opponentAbbr: known('DEN'),
    matchupLabel: known('OKC @ DEN'),
    propKind: known(partial.market ?? 'points'),
    propLabel: known('Points'),
    side: known(partial.side ?? 'over'),
    line: known(partial.line ?? 11.5),
    oddsAmerican: known(-130),
    sportsbookText: known(partial.sportsbook ?? 'DraftKings'),
    gameDate: known('2026-04-02'),
    extractionConfidence: known('high'),
    resolution: 'resolved',
    rawSnippet: null,
  });
}

export function resolution(partial?: {
  market?: CanonicalPropType;
  line?: number;
  playerId?: string | null;
  gameId?: string | null;
  teamId?: string | null;
  opponentId?: string | null;
}): CanonicalParlayLegResolution {
  const playerId = partial?.playerId === undefined ? PLAYER : partial.playerId;
  const gameId = partial?.gameId === undefined ? TARGET_GAME : partial.gameId;
  const market = partial?.market ?? 'points';
  return {
    originalLeg: extracted({ market: market as XrayPropKind, line: partial?.line ?? 11.5 }),
    playerResolution: {
      status: playerId ? 'RESOLVED' : 'UNRESOLVED',
      value: playerId
        ? { playerId, entityId: 'ent-ajay', displayName: 'Ajay Mitchell', nbaPlayerId: playerId }
        : null,
      extracted: 'Ajay Mitchell',
      reason: playerId ? null : 'PLAYER_UNRESOLVED',
      candidates: [],
    },
    teamResolution: {
      status: 'RESOLVED',
      value: { abbreviation: 'OKC', teamId: partial?.teamId ?? TEAM },
      extracted: 'OKC',
      reason: null,
    },
    opponentResolution: {
      status: 'RESOLVED',
      value: { abbreviation: 'DEN', teamId: partial?.opponentId ?? OPP },
      extracted: 'DEN',
      reason: null,
    },
    gameResolution: {
      status: gameId ? 'RESOLVED' : 'UNRESOLVED',
      value: gameId
        ? {
            gameId,
            startTime: CUTOFF,
            homeTeamAbbr: 'DEN',
            awayTeamAbbr: 'OKC',
          }
        : null,
      extracted: '2026-04-02',
      reason: gameId ? null : 'GAME_UNRESOLVED',
      candidates: [],
    },
    marketResolution: {
      status: 'RESOLVED',
      value: { propType: market },
      extracted: market,
      reason: null,
      unsupported: false,
    },
    sideResolution: { status: 'RESOLVED', value: 'over', extracted: 'over', reason: null },
    lineResolution: { status: 'RESOLVED', value: partial?.line ?? 11.5, extracted: partial?.line ?? 11.5, reason: null },
    sportsbookResolution: {
      status: 'RESOLVED',
      value: { vendor: 'draftkings', displayName: 'DraftKings' },
      extracted: 'DraftKings',
      reason: null,
    },
    overallStatus: playerId && gameId ? 'FULLY_RESOLVED' : 'UNRESOLVED',
    coreResolved: Boolean(playerId && gameId),
    fullyResolved: Boolean(playerId && gameId),
  };
}

export function log(partial: Partial<XrayPriorPlayerLog> & Pick<XrayPriorPlayerLog, 'gameId' | 'startTime'>): XrayPriorPlayerLog {
  return {
    playerId: PLAYER,
    teamId: TEAM,
    season: '2026',
    minutes: 28,
    points: 14,
    rebounds: 4,
    assists: 3,
    threePointersMade: 1,
    ...partial,
  };
}

export function teamStat(
  partial: Partial<XrayPriorTeamStat> & Pick<XrayPriorTeamStat, 'gameId' | 'startTime' | 'teamId'>
): XrayPriorTeamStat {
  return {
    opponentTeamId: partial.teamId === TEAM ? OPP : TEAM,
    season: '2026',
    pace: 100,
    pointsAllowed: 110,
    teamPoints: 115,
    ...partial,
  };
}

export function priorLogs(count: number, opts?: { startIndex?: number; season?: string }): XrayPriorPlayerLog[] {
  const start = opts?.startIndex ?? 1;
  const rows: XrayPriorPlayerLog[] = [];
  for (let i = 0; i < count; i++) {
    const n = start + i;
    rows.push(
      log({
        gameId: `prior-${n}`,
        startTime: `2026-03-${String(Math.max(1, 20 - i)).padStart(2, '0')}T01:00:00.000Z`,
        season: opts?.season ?? '2026',
        points: 10 + (i % 8),
        rebounds: 3 + (i % 4),
        assists: 2 + (i % 3),
        threePointersMade: i % 3,
        minutes: 24 + (i % 10),
      })
    );
  }
  return rows;
}

export const TARGET_LOG = log({
  gameId: TARGET_GAME,
  startTime: CUTOFF,
  points: 99,
  rebounds: 99,
  assists: 99,
  minutes: 48,
});

export const FUTURE_LOG = log({
  gameId: 'future-1',
  startTime: '2026-04-10T01:30:00.000Z',
  points: 50,
  rebounds: 20,
  assists: 15,
  minutes: 40,
});

export function mmRow(partial: Partial<HistoricalMovementRow> = {}): HistoricalMovementRow {
  return {
    game_id: TARGET_GAME,
    player_id: PLAYER,
    prop_type: 'points',
    vendor: 'draftkings',
    reference_kind: '3_hour_pre_tip',
    reference_line: 11.5,
    reference_over_odds: -130,
    reference_under_odds: 110,
    reference_timestamp: '2026-04-02T22:30:00.000Z',
    comparison_kind: 'decision_close',
    comparison_line: 12.5,
    comparison_over_odds: -107,
    comparison_under_odds: -113,
    comparison_timestamp: '2026-04-03T01:15:29.542Z',
    ...partial,
  };
}

export function matchedPoints(line = 11.5) {
  return matchHistoricalParlayLeg(
    replayInput({
      historicalDate: '2026-04-02',
      playerId: PLAYER,
      playerDisplayName: 'Ajay Mitchell',
      gameId: TARGET_GAME,
      market: 'points',
      line,
      sportsbookVendor: 'draftkings',
    }),
    [mmRow()]
  );
}

export function archivedProjection(partial: Partial<XrayArchivedProjection> = {}): XrayArchivedProjection {
  return {
    playerId: PLAYER,
    gameId: TARGET_GAME,
    modelVersion: 'player-projection-learned-r1-pts-reb-c',
    generatedAt: '2026-04-03T00:30:00.000Z',
    intendedCutoffAt: '2026-04-03T00:30:00.000Z',
    predictions: { pts: 12.2, reb: 3.1 },
    ...partial,
  };
}
