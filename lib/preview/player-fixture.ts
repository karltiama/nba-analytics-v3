import type { GameLog, PlayerProfile, SeasonAverages } from '@/lib/players/types';
import {
  playerDisplayName,
  PREVIEW_DATE_ET,
  PREVIEW_SEASON,
  PREVIEW_TEAMS,
  previewPlayerById,
  previewPlayerByKey,
  type PreviewPlayer,
} from './catalog';
import { previewId } from './ids';
import type { PreviewScenario } from './scenario';

const RECENT_OPPONENTS = ['RWR', 'CBN', 'LVN', 'HCH', 'RWR'] as const;

export function previewPlayerProfile(
  player: PreviewPlayer,
  scenario: PreviewScenario
): PlayerProfile {
  const name = playerDisplayName(player, scenario);
  const [first = name, ...rest] = name.split(' ');
  return {
    player_id: String(player.playerId),
    full_name: name,
    first_name: first,
    last_name: rest.join(' ') || null,
    position: player.position,
    active: true,
    nba_player_id: null,
    height: player.sparse ? null : '6-7',
    weight: player.sparse ? null : '215',
  };
}

export function previewSeasonAverages(
  player: PreviewPlayer,
  scenario: PreviewScenario
): SeasonAverages | null {
  if (player.sparse || scenario === 'empty' || scenario === 'partial') return null;
  return {
    games_played: 62,
    games_active: 62,
    games_started: 58,
    avg_points: 24.8,
    avg_rebounds: 6.4,
    avg_assists: 5.1,
    avg_steals: 1.1,
    avg_blocks: 0.4,
    avg_turnovers: 2.2,
    avg_minutes: 34.2,
    avg_plus_minus: 3.4,
    fg_pct: 0.478,
    three_pct: 0.372,
    ft_pct: 0.841,
  };
}

export function previewGameLogs(
  player: PreviewPlayer,
  scenario: PreviewScenario
): GameLog[] {
  if (player.sparse || scenario === 'empty') return [];
  const count = scenario === 'partial' ? 1 : 5;
  const team = PREVIEW_TEAMS[player.teamKey];
  return Array.from({ length: count }, (_, index) => {
    const opponentAbbr = RECENT_OPPONENTS[index % RECENT_OPPONENTS.length];
    const missing = scenario === 'partial';
    return {
      game_id: previewId(`log-${player.key}-${index + 1}`),
      game_date: `2026-03-${String(20 + index).padStart(2, '0')}`,
      start_time: `2026-03-${String(20 + index).padStart(2, '0')}T23:30:00.000Z`,
      season: PREVIEW_SEASON,
      team_id: team.id,
      team_abbr: team.abbreviation,
      team_name: team.name,
      opponent_id: previewId(`opp-${opponentAbbr}`),
      opponent_abbr: opponentAbbr,
      opponent_name: opponentAbbr,
      location: index % 2 === 0 ? 'home' : 'away',
      result: index % 2 === 0 ? 'W' : 'L',
      team_score: missing ? null : 112,
      opponent_score: missing ? null : 106,
      minutes: missing ? null : 34,
      points: missing ? null : 22 + index,
      rebounds: missing ? null : 6 + (index % 3),
      assists: missing ? null : 4 + (index % 2),
      steals: 1,
      blocks: 0,
      turnovers: 2,
      field_goals_made: 8,
      field_goals_attempted: 16,
      three_pointers_made: 2 + (index % 2),
      three_pointers_attempted: 6,
      free_throws_made: 4,
      free_throws_attempted: 5,
      plus_minus: index % 2 === 0 ? 8 : -3,
      started: true,
      dnp_reason: null,
      offensive_rebounds: 1,
      defensive_rebounds: 5,
      personal_fouls: 2,
    } satisfies GameLog;
  });
}

export function previewGameLogPayload(
  playerId: string,
  scenario: PreviewScenario
): { status: number; body: unknown } {
  if (scenario === 'error') {
    return {
      status: 500,
      body: { error: 'Failed to load preview', message: 'Preview error scenario' },
    };
  }
  const player = previewPlayerById(playerId);
  if (!player || scenario === 'empty') {
    return { status: 404, body: { error: 'Player not found' } };
  }
  return {
    status: 200,
    body: {
      player: previewPlayerProfile(player, scenario),
      seasonAverages: previewSeasonAverages(player, scenario),
      games: previewGameLogs(player, scenario),
      resolvedPlayerId: String(player.playerId),
      previewDate: PREVIEW_DATE_ET,
    },
  };
}

export function sparsePreviewPlayer(): PreviewPlayer {
  return previewPlayerByKey('pell');
}
