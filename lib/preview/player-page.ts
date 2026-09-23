import type { TeamMatchupGame } from '@/lib/analytics/games-queries';
import type { OpponentContext } from '@/lib/analytics/matchup-queries';
import type { GameLog, PlayerProfile, PlayerRecentForm, PlayerVsOpponentHistory, SeasonAverages } from '@/lib/players/types';
import { PREVIEW_GAMES, PREVIEW_TEAMS } from './catalog';
import { previewPlayerById } from './catalog';
import {
  previewGameLogs,
  previewPlayerProfile,
  previewSeasonAverages,
} from './player-fixture';
import type { PreviewScenario } from './scenario';

export type PreviewPlayerPageModel = {
  analyticsPlayerId: string | null;
  player: PlayerProfile | null;
  seasonAverages: SeasonAverages;
  games: GameLog[];
  nextGame: TeamMatchupGame | null;
  opponentContext: OpponentContext | null;
  recentForm: PlayerRecentForm | null;
  vsOpponentHistory: PlayerVsOpponentHistory | null;
  activeSeason: string;
};

export function buildPreviewPlayerPage(playerId: string, scenario: PreviewScenario): PreviewPlayerPageModel {
  const empty: PreviewPlayerPageModel = {
    analyticsPlayerId: null,
    player: null,
    seasonAverages: {},
    games: [],
    nextGame: null,
    opponentContext: null,
    recentForm: null,
    vsOpponentHistory: null,
    activeSeason: '2025',
  };
  if (scenario === 'error') return empty;
  const player = previewPlayerById(playerId);
  if (!player) return empty;
  const games = previewGameLogs(player, scenario);
  const seasonAverages = previewSeasonAverages(player, scenario) ?? {};
  const profile = previewPlayerProfile(player, scenario);
  const team = PREVIEW_TEAMS[player.teamKey];
  const opponent = PREVIEW_TEAMS.rapids;
  const game = PREVIEW_GAMES[0];
  const sparse = player.sparse || scenario === 'empty' || scenario === 'partial';
  const nextGame: TeamMatchupGame | null = sparse
    ? null
    : {
        game_id: String(game.gameId),
        season: '2025',
        start_time: '2026-04-02T23:30:00.000Z',
        home_team_id: PREVIEW_TEAMS.rapids.id,
        away_team_id: team.id,
        home_score: null,
        away_score: null,
        status: 'Scheduled',
        opponent_team_id: opponent.id,
        opponent_abbr: opponent.abbreviation,
        opponent_name: scenario === 'mobile-dense' ? opponent.denseName : opponent.name,
        is_home: false,
        team_abbr: team.abbreviation,
        team_name: scenario === 'mobile-dense' ? team.denseName : team.name,
      };
  return {
    analyticsPlayerId: String(player.playerId),
    player: profile,
    seasonAverages,
    games,
    nextGame,
    opponentContext: sparse
      ? null
      : {
          avg_defensive_rating: 112.4,
          avg_pace: 100.2,
          avg_points_allowed: 114.6,
          avg_rebounds_allowed: 44.1,
        },
    recentForm: sparse
      ? null
      : {
          games_played: 5,
          avg_pts: 26.4,
          avg_reb: 6.2,
          avg_ast: 5.4,
          avg_pra: 38.0,
          avg_minutes: 34.2,
        },
    vsOpponentHistory: sparse
      ? null
      : {
          games_played: games.length,
          avg_pts: 22.5,
          avg_reb: 6,
          avg_ast: 4.5,
          avg_pra: 33,
          games,
        },
    activeSeason: '2025',
  };
}
