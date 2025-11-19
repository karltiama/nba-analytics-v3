import Link from 'next/link';
import { getMultipleOpponentDefensiveRankings } from '@/lib/players/queries';

interface GameMatchupInfoProps {
  game: {
    game_id: string;
    home_team_id: string;
    away_team_id: string;
    home_team_abbr: string;
    away_team_abbr: string;
    home_team_name: string;
    away_team_name: string;
    start_time: string;
    status: string;
    season: string;
  };
}

export async function GameMatchupInfo({ game }: GameMatchupInfoProps) {
  // Get defensive rankings for both teams in a single query
  const rankingsMap = await getMultipleOpponentDefensiveRankings(
    [game.home_team_id, game.away_team_id],
    game.season || null
  );
  const homeRankings = rankingsMap[game.home_team_id] || {};
  const awayRankings = rankingsMap[game.away_team_id] || {};

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
      <h2 className="text-2xl font-semibold text-black dark:text-zinc-50 mb-4">
        Matchup Analysis
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Away Team Defense */}
        <div>
          <h3 className="text-lg font-semibold text-black dark:text-zinc-50 mb-3">
            <Link
              href={`/teams/${game.away_team_id}`}
              className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
            >
              {game.away_team_name} Defense
            </Link>
          </h3>
          {awayRankings.points_allowed_rank ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-600 dark:text-zinc-400">Points Allowed Rank:</span>
                  <span className="font-medium">
                    #{awayRankings.points_allowed_rank} of 30
                    <span className="ml-2 text-zinc-500">
                      ({awayRankings.points_allowed_per_game != null ? Number(awayRankings.points_allowed_per_game).toFixed(1) : '-'} PPG)
                    </span>
                  </span>
              </div>
              {awayRankings.rebounds_allowed_rank && (
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Rebounds Allowed Rank:</span>
                  <span className="font-medium">
                    #{awayRankings.rebounds_allowed_rank} of 30
                    <span className="ml-2 text-zinc-500">
                      ({awayRankings.rebounds_allowed_per_game != null ? Number(awayRankings.rebounds_allowed_per_game).toFixed(1) : '-'} RPG)
                    </span>
                  </span>
                </div>
              )}
              {awayRankings.assists_allowed_rank && (
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Assists Allowed Rank:</span>
                  <span className="font-medium">
                    #{awayRankings.assists_allowed_rank} of 30
                    <span className="ml-2 text-zinc-500">
                      ({awayRankings.assists_allowed_per_game != null ? Number(awayRankings.assists_allowed_per_game).toFixed(1) : '-'} APG)
                    </span>
                  </span>
                </div>
              )}
              {awayRankings.fg_pct_allowed_rank && (
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">FG% Allowed Rank:</span>
                  <span className="font-medium">
                    #{awayRankings.fg_pct_allowed_rank} of 30
                    <span className="ml-2 text-zinc-500">
                      ({awayRankings.fg_pct_allowed != null ? Number(awayRankings.fg_pct_allowed).toFixed(1) : '-'}%)
                    </span>
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-zinc-500 text-sm">No defensive data available</p>
          )}
        </div>

        {/* Home Team Defense */}
        <div>
          <h3 className="text-lg font-semibold text-black dark:text-zinc-50 mb-3">
            <Link
              href={`/teams/${game.home_team_id}`}
              className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
            >
              {game.home_team_name} Defense
            </Link>
          </h3>
          {homeRankings.points_allowed_rank ? (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-600 dark:text-zinc-400">Points Allowed Rank:</span>
                  <span className="font-medium">
                    #{homeRankings.points_allowed_rank} of 30
                    <span className="ml-2 text-zinc-500">
                      ({homeRankings.points_allowed_per_game != null ? Number(homeRankings.points_allowed_per_game).toFixed(1) : '-'} PPG)
                    </span>
                  </span>
              </div>
              {homeRankings.rebounds_allowed_rank && (
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Rebounds Allowed Rank:</span>
                  <span className="font-medium">
                    #{homeRankings.rebounds_allowed_rank} of 30
                    <span className="ml-2 text-zinc-500">
                      ({homeRankings.rebounds_allowed_per_game != null ? Number(homeRankings.rebounds_allowed_per_game).toFixed(1) : '-'} RPG)
                    </span>
                  </span>
                </div>
              )}
              {homeRankings.assists_allowed_rank && (
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">Assists Allowed Rank:</span>
                  <span className="font-medium">
                    #{homeRankings.assists_allowed_rank} of 30
                    <span className="ml-2 text-zinc-500">
                      ({homeRankings.assists_allowed_per_game != null ? Number(homeRankings.assists_allowed_per_game).toFixed(1) : '-'} APG)
                    </span>
                  </span>
                </div>
              )}
              {homeRankings.fg_pct_allowed_rank && (
                <div className="flex justify-between">
                  <span className="text-zinc-600 dark:text-zinc-400">FG% Allowed Rank:</span>
                  <span className="font-medium">
                    #{homeRankings.fg_pct_allowed_rank} of 30
                    <span className="ml-2 text-zinc-500">
                      ({homeRankings.fg_pct_allowed != null ? Number(homeRankings.fg_pct_allowed).toFixed(1) : '-'}%)
                    </span>
                  </span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-zinc-500 text-sm">No defensive data available</p>
          )}
        </div>
      </div>
      
      {/* Matchup Context */}
      <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-800">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          <strong>Note:</strong> Lower rank numbers indicate better defense (allows fewer points/rebounds/assists).
          Rank #1 = best defense, Rank #30 = worst defense.
        </p>
      </div>
    </div>
  );
}

