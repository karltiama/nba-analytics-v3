import { known, needsConfirmation, unknown, withDerivedResolution } from '@/lib/parlay-xray/fields';
import type { TargetGameContextRow } from '@/lib/parlay-xray/context/load';
import type { XRayContextSources, XrayPriorPlayerLog, XrayPriorTeamStat } from '@/lib/parlay-xray/context/types';
import type { HistoricalMovementRow } from '@/lib/parlay-xray/replay/types';
import type { XrayResolutionCatalog } from '@/lib/parlay-xray/resolution/types';
import type { ExtractedParlayLeg, XrayPropKind } from '@/lib/parlay-xray/types';
import type { HistoricalXrayReplayContext, HistoricalXrayReplayDeps } from './types';
import {
  X3F_AJAY_ID,
  X3F_AJAY_NBA_PLAYER_ID,
  X3F_AWAY_ABBR,
  X3F_AWAY_TEAM_ID,
  X3F_CUTOFF_AT,
  X3F_DORT_ID,
  X3F_DORT_NBA_PLAYER_ID,
  X3F_GAME_ID,
  X3F_GROUND_TRUTH_LEGS,
  X3F_HISTORICAL_DATE,
  X3F_HOME_ABBR,
  X3F_HOME_TEAM_ID,
  X3F_LUKA_ID,
  X3F_LUKA_NBA_PLAYER_ID,
  X3F_NBA_PLAYER_ID_BY_PLAYER_ID,
  X3F_REPLAY_CONTEXT,
  X3F_SEASON,
  type X3FGroundTruthLeg,
} from './ground-truth';

function ocrSnippet(leg: X3FGroundTruthLeg): string {
  const side = leg.side === 'over' ? 'O' : 'U';
  const market = leg.market === 'assists' ? 'AST' : 'PTS';
  return `${leg.ocrPlayerName} ${side} ${leg.requestedLine} ${market}`;
}

function baseLeg(
  leg: X3FGroundTruthLeg,
  playerName: string,
  playerStatus: 'known' | 'needs_confirmation',
  oddsMode: 'extracted' | 'confirmed' = 'extracted'
): ExtractedParlayLeg {
  const nameField =
    playerStatus === 'needs_confirmation' ? needsConfirmation(playerName) : known(playerName);
  // Extracted OCR leaves Dort price unknown; confirmed / Workspace legs use close odds for a real combined total.
  const odds =
    oddsMode === 'extracted' && leg.id === 'leg-dort-pts' ? unknown<number>() : known(leg.closeOverOdds);
  return withDerivedResolution({
    id: leg.id,
    playerDisplayName: nameField,
    playerId: unknown(),
    nbaPlayerId: (() => {
      const nbaId = X3F_NBA_PLAYER_ID_BY_PLAYER_ID[leg.canonicalPlayerId];
      return nbaId ? known(nbaId) : unknown();
    })(),
    teamAbbr: known(leg.teamAbbr),
    opponentAbbr: known(leg.opponentAbbr),
    matchupLabel: known(`${X3F_AWAY_ABBR} @ ${X3F_HOME_ABBR}`),
    propKind: known(leg.market as XrayPropKind),
    propLabel: known(leg.market === 'assists' ? 'Assists' : 'Points'),
    side: known(leg.side),
    line: known(leg.requestedLine),
    oddsAmerican: odds,
    sportsbookText: known('DraftKings'),
    gameDate: known(X3F_HISTORICAL_DATE),
    extractionConfidence: playerStatus === 'needs_confirmation' ? known('medium') : known('high'),
    resolution: 'unresolved',
    rawSnippet: ocrSnippet(leg),
  });
}

/** Screenshot/OCR layer (player names match confirmed spelling in the locked fixture). */
export function buildX3fExtractedLegs(): ExtractedParlayLeg[] {
  return X3F_GROUND_TRUTH_LEGS.map((leg) =>
    baseLeg(
      leg,
      leg.ocrPlayerName,
      leg.ocrPlayerName === leg.confirmedPlayerName ? 'known' : 'needs_confirmation',
      'extracted'
    )
  );
}

/** Confirmed user legs. OCR remains in rawSnippet; prices use locked close odds. */
export function buildX3fConfirmedLegs(): ExtractedParlayLeg[] {
  return X3F_GROUND_TRUTH_LEGS.map((leg) => baseLeg(leg, leg.confirmedPlayerName, 'known', 'confirmed'));
}

export const X3F_CATALOG: XrayResolutionCatalog = {
  players: [
    {
      playerId: X3F_AJAY_ID,
      entityId: '25655aff-09a0-5744-9ca8-3e60a52e3871',
      displayName: 'Ajay Mitchell',
      firstName: 'Ajay',
      lastName: 'Mitchell',
      nbaPlayerId: X3F_AJAY_NBA_PLAYER_ID,
    },
    {
      playerId: X3F_DORT_ID,
      entityId: '83d2eb6d-1ebb-5040-9f0c-18c011843579',
      displayName: 'Luguentz Dort',
      firstName: 'Luguentz',
      lastName: 'Dort',
      nbaPlayerId: X3F_DORT_NBA_PLAYER_ID,
    },
    {
      playerId: X3F_LUKA_ID,
      entityId: 'a4f5815c-dcbb-5b5a-9c4e-9decda7f1de4',
      displayName: 'Luka Doncic',
      firstName: 'Luka',
      lastName: 'Doncic',
      nbaPlayerId: X3F_LUKA_NBA_PLAYER_ID,
    },
  ],
  teams: [
    { teamId: X3F_HOME_TEAM_ID, abbreviation: 'OKC', fullName: 'Oklahoma City Thunder' },
    { teamId: X3F_AWAY_TEAM_ID, abbreviation: 'LAL', fullName: 'Los Angeles Lakers' },
  ],
  games: [
    {
      gameId: X3F_GAME_ID,
      startTime: X3F_CUTOFF_AT,
      homeTeamAbbr: X3F_HOME_ABBR,
      awayTeamAbbr: X3F_AWAY_ABBR,
    },
  ],
};

function mmRow(partial: {
  player_id: string;
  prop_type: string;
  reference_line: number;
  comparison_line: number;
  reference_over_odds: number;
  reference_under_odds: number;
  comparison_over_odds: number;
  comparison_under_odds: number;
  comparison_timestamp: string;
}): HistoricalMovementRow {
  return {
    game_id: X3F_GAME_ID,
    player_id: partial.player_id,
    prop_type: partial.prop_type,
    vendor: 'draftkings',
    reference_kind: '3_hour_pre_tip',
    reference_line: partial.reference_line,
    reference_over_odds: partial.reference_over_odds,
    reference_under_odds: partial.reference_under_odds,
    reference_timestamp: '2026-04-02T22:30:00.000Z',
    comparison_kind: 'decision_close',
    comparison_line: partial.comparison_line,
    comparison_over_odds: partial.comparison_over_odds,
    comparison_under_odds: partial.comparison_under_odds,
    comparison_timestamp: partial.comparison_timestamp,
  };
}

/** Certified DK 3h/close rows for the four-leg replay. No outcomes. */
export const X3F_MOVEMENT_ROWS: HistoricalMovementRow[] = [
  mmRow({
    player_id: X3F_AJAY_ID,
    prop_type: 'points',
    reference_line: 11.5,
    comparison_line: 12.5,
    reference_over_odds: -130,
    reference_under_odds: 102,
    comparison_over_odds: -107,
    comparison_under_odds: -119,
    comparison_timestamp: '2026-04-03T01:15:29.542Z',
  }),
  mmRow({
    player_id: X3F_AJAY_ID,
    prop_type: 'assists',
    reference_line: 2.5,
    comparison_line: 2.5,
    reference_over_odds: -147,
    reference_under_odds: 111,
    comparison_over_odds: -161,
    comparison_under_odds: 122,
    comparison_timestamp: '2026-04-03T01:00:35.436Z',
  }),
  mmRow({
    player_id: X3F_DORT_ID,
    prop_type: 'points',
    reference_line: 6.5,
    comparison_line: 7.5,
    reference_over_odds: -117,
    reference_under_odds: -109,
    comparison_over_odds: -103,
    comparison_under_odds: -123,
    comparison_timestamp: '2026-04-03T01:00:35.436Z',
  }),
  mmRow({
    player_id: X3F_LUKA_ID,
    prop_type: 'points',
    reference_line: 31.5,
    comparison_line: 30.5,
    reference_over_odds: -108,
    reference_under_odds: -118,
    comparison_over_odds: -120,
    comparison_under_odds: -106,
    comparison_timestamp: '2026-04-03T01:00:35.436Z',
  }),
];

export const X3F_TARGET_GAME: TargetGameContextRow = {
  gameId: X3F_GAME_ID,
  startTime: X3F_CUTOFF_AT,
  season: X3F_SEASON,
  homeTeamId: X3F_HOME_TEAM_ID,
  awayTeamId: X3F_AWAY_TEAM_ID,
  homeAbbr: X3F_HOME_ABBR,
  awayAbbr: X3F_AWAY_ABBR,
};

function priorLog(partial: {
  playerId: string;
  teamId: string;
  gameId: string;
  startTime: string;
  minutes: number;
  points: number;
  rebounds: number;
  assists: number;
}): XrayPriorPlayerLog {
  return {
    playerId: partial.playerId,
    gameId: partial.gameId,
    teamId: partial.teamId,
    startTime: partial.startTime,
    season: X3F_SEASON,
    minutes: partial.minutes,
    points: partial.points,
    rebounds: partial.rebounds,
    assists: partial.assists,
    threePointersMade: 1,
  };
}

function marchStamp(day: number, hour = 1): string {
  return `2026-03-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;
}

function playerLogs(
  playerId: string,
  teamId: string,
  count: number,
  seed: { minutes: number; points: number; rebounds: number; assists: number }
): XrayPriorPlayerLog[] {
  const rows: XrayPriorPlayerLog[] = [];
  for (let i = 0; i < count; i += 1) {
    const day = 28 - i;
    rows.push(
      priorLog({
        playerId,
        teamId,
        gameId: `prior-${playerId}-${i + 1}`,
        startTime: marchStamp(Math.max(1, day)),
        minutes: seed.minutes - (i % 3),
        points: seed.points - (i % 5),
        rebounds: seed.rebounds,
        assists: seed.assists + (i % 2),
      })
    );
  }
  return rows;
}

function teamStat(teamId: string, opponentTeamId: string, gameId: string, startTime: string, pointsAllowed: number): XrayPriorTeamStat {
  return {
    teamId,
    gameId,
    opponentTeamId,
    startTime,
    season: X3F_SEASON,
    pace: teamId === X3F_HOME_TEAM_ID ? 99.4 : 101.2,
    pointsAllowed,
    teamPoints: teamId === X3F_HOME_TEAM_ID ? 118 : 112,
  };
}

export const X3F_TARGET_GAME_SENTINEL_LOG: XrayPriorPlayerLog = priorLog({
  playerId: X3F_AJAY_ID,
  teamId: X3F_HOME_TEAM_ID,
  gameId: X3F_GAME_ID,
  startTime: X3F_CUTOFF_AT,
  minutes: 48,
  points: 99,
  rebounds: 99,
  assists: 99,
});

export const X3F_FUTURE_SENTINEL_LOG: XrayPriorPlayerLog = priorLog({
  playerId: X3F_AJAY_ID,
  teamId: X3F_HOME_TEAM_ID,
  gameId: 'future-x3f-1',
  startTime: '2026-04-10T01:30:00.000Z',
  minutes: 40,
  points: 50,
  rebounds: 20,
  assists: 15,
});

const TEAM_STATS: XrayPriorTeamStat[] = [
  teamStat(X3F_HOME_TEAM_ID, X3F_AWAY_TEAM_ID, 'okc-prior-1', marchStamp(20), 108),
  teamStat(X3F_HOME_TEAM_ID, X3F_AWAY_TEAM_ID, 'okc-prior-2', marchStamp(18), 111),
  teamStat(X3F_AWAY_TEAM_ID, X3F_HOME_TEAM_ID, 'lal-prior-1', marchStamp(21), 114),
  teamStat(X3F_AWAY_TEAM_ID, X3F_HOME_TEAM_ID, 'lal-prior-2', marchStamp(17), 109),
];

export function buildX3fContextSources(): Record<string, XRayContextSources> {
  return {
    [X3F_AJAY_ID]: {
      priorPlayerLogs: playerLogs(X3F_AJAY_ID, X3F_HOME_TEAM_ID, 12, {
        minutes: 28,
        points: 14,
        rebounds: 3,
        assists: 3,
      }),
      priorTeamStats: TEAM_STATS,
      projectionSnapshots: [],
    },
    [X3F_DORT_ID]: {
      priorPlayerLogs: playerLogs(X3F_DORT_ID, X3F_HOME_TEAM_ID, 3, {
        minutes: 26,
        points: 8,
        rebounds: 3,
        assists: 1,
      }),
      priorTeamStats: TEAM_STATS,
      projectionSnapshots: [],
    },
    [X3F_LUKA_ID]: {
      priorPlayerLogs: playerLogs(X3F_LUKA_ID, X3F_AWAY_TEAM_ID, 12, {
        minutes: 36,
        points: 28,
        rebounds: 8,
        assists: 8,
      }),
      priorTeamStats: TEAM_STATS,
      projectionSnapshots: [],
    },
  };
}

export function buildX3fReplayContext(): HistoricalXrayReplayContext {
  return {
    historicalDate: X3F_REPLAY_CONTEXT.historicalDate,
    cutoffAt: X3F_REPLAY_CONTEXT.cutoffAt,
    gameId: X3F_REPLAY_CONTEXT.gameId,
    dateLabel: X3F_REPLAY_CONTEXT.dateLabel,
    season: X3F_REPLAY_CONTEXT.season,
    slateLabel: X3F_REPLAY_CONTEXT.slateLabel,
  };
}

export function buildX3fReplayDeps(): HistoricalXrayReplayDeps {
  return {
    catalog: X3F_CATALOG,
    movementRows: X3F_MOVEMENT_ROWS,
    targetGame: X3F_TARGET_GAME,
    sourcesByPlayerId: buildX3fContextSources(),
  };
}
